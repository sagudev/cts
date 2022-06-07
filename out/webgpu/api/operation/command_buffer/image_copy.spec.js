/**
* AUTO-GENERATED - DO NOT EDIT. Source: https://github.com/gpuweb/cts
**/export const description = `writeTexture + copyBufferToTexture + copyTextureToBuffer operation tests.

* copy_with_various_rows_per_image_and_bytes_per_row: test that copying data with various bytesPerRow (including { ==, > } bytesInACompleteRow) and\
 rowsPerImage (including { ==, > } copyExtent.height) values and minimum required bytes in copy works for every format. Also covers special code paths:
  - bufferSize - offset < bytesPerImage * copyExtent.depthOrArrayLayers
  - when bytesPerRow is not a multiple of 512 and copyExtent.depthOrArrayLayers > 1: copyExtent.depthOrArrayLayers % 2 == { 0, 1 }
  - bytesPerRow == bytesInACompleteCopyImage

* copy_with_various_offsets_and_data_sizes: test that copying data with various offset (including { ==, > } 0 and is/isn't power of 2) values and additional\
 data paddings works for every format with 2d and 2d-array textures. Also covers special code paths:
  - offset + bytesInCopyExtentPerRow { ==, > } bytesPerRow
  - offset > bytesInACompleteCopyImage

* copy_with_various_origins_and_copy_extents: test that copying slices of a texture works with various origin (including { origin.x, origin.y, origin.z }\
 { ==, > } 0 and is/isn't power of 2) and copyExtent (including { copyExtent.x, copyExtent.y, copyExtent.z } { ==, > } 0 and is/isn't power of 2) values\
 (also including {origin._ + copyExtent._ { ==, < } the subresource size of textureCopyView) works for all formats. origin and copyExtent values are passed\
 as [number, number, number] instead of GPUExtent3DDict.

* copy_various_mip_levels: test that copying various mip levels works for all formats. Also covers special code paths:
  - the physical size of the subresource is not equal to the logical size
  - bufferSize - offset < bytesPerImage * copyExtent.depthOrArrayLayers and copyExtent needs to be clamped

* copy_with_no_image_or_slice_padding_and_undefined_values: test that when copying a single row we can set any bytesPerRow value and when copying a single\
 slice we can set rowsPerImage to 0. Also test setting offset, rowsPerImage, mipLevel, origin, origin.{x,y,z} to undefined.

* TODO:
  - add another initMethod which renders the texture [3]
  - test copyT2B with buffer size not divisible by 4 (not done because expectContents 4-byte alignment)
  - Convert the float32 values in initialData into the ones compatible to the depth aspect of
    depthFormats when depth16unorm is supported by the browsers in
    DoCopyTextureToBufferWithDepthAspectTest().

TODO: Expand tests of GPUExtent3D [1]

TODO: Fix this test for the various skipped formats [2]:
- snorm tests failing due to rounding
- float tests failing because float values are not byte-preserved
- compressed formats
`;import { makeTestGroup } from '../../../../common/framework/test_group.js';
import { assert, memcpy, unreachable } from '../../../../common/util/util.js';
import {
kTextureFormatInfo,

kDepthStencilFormats,
kMinDynamicBufferOffsetAlignment,
kBufferSizeAlignment,

depthStencilBufferTextureCopySupported,
depthStencilFormatAspectSize,
kTextureDimensions,
textureDimensionAndFormatCompatible,
kColorTextureFormats } from
'../../../capability_info.js';
import { GPUTest } from '../../../gpu_test.js';
import { makeBufferWithContents } from '../../../util/buffer.js';
import { align } from '../../../util/math.js';
import {
bytesInACompleteRow,
dataBytesForCopyOrFail,
getTextureCopyLayout,
kBytesPerRowAlignment } from

'../../../util/texture/layout.js';


































/** Each combination of methods assume that the ones before it were tested and work correctly. */
const kMethodsToTest = [
// Then we make sure that WriteTexture works for all formats:
{ initMethod: 'WriteTexture', checkMethod: 'FullCopyT2B' },
// Then we make sure that CopyB2T works for all formats:
{ initMethod: 'CopyB2T', checkMethod: 'FullCopyT2B' },
// Then we make sure that CopyT2B works for all formats:
{ initMethod: 'WriteTexture', checkMethod: 'PartialCopyT2B' }];


// [2]: Fix things so this list can be reduced to zero (see file description)
const kExcludedFormats = new Set([
'r8snorm',
'rg8snorm',
'rgba8snorm',
'rg11b10ufloat',
'rg16float',
'rgba16float',
'r32float',
'rg32float',
'rgba32float']);

const kWorkingColorTextureFormats = kColorTextureFormats.filter((x) => !kExcludedFormats.has(x));

class ImageCopyTest extends GPUTest {
  /** Offset for a particular texel in the linear texture data */
  getTexelOffsetInBytes(
  textureDataLayout,
  format,
  texel,
  origin = { x: 0, y: 0, z: 0 })
  {
    const { offset, bytesPerRow, rowsPerImage } = textureDataLayout;
    const info = kTextureFormatInfo[format];

    assert(texel.x >= origin.x && texel.y >= origin.y && texel.z >= origin.z);
    assert(texel.x % info.blockWidth === 0);
    assert(texel.y % info.blockHeight === 0);
    assert(origin.x % info.blockWidth === 0);
    assert(origin.y % info.blockHeight === 0);

    const bytesPerImage = rowsPerImage * bytesPerRow;

    return (
      offset +
      (texel.z - origin.z) * bytesPerImage +
      (texel.y - origin.y) / info.blockHeight * bytesPerRow +
      (texel.x - origin.x) / info.blockWidth * info.bytesPerBlock);

  }

  *iterateBlockRows(
  size,
  origin,
  format)
  {
    if (size.width === 0 || size.height === 0 || size.depthOrArrayLayers === 0) {
      // do not iterate anything for an empty region
      return;
    }
    const info = kTextureFormatInfo[format];
    assert(size.height % info.blockHeight === 0);
    for (let y = 0; y < size.height; y += info.blockHeight) {
      for (let z = 0; z < size.depthOrArrayLayers; ++z) {
        yield {
          x: origin.x,
          y: origin.y + y,
          z: origin.z + z };

      }
    }
  }

  generateData(byteSize, start = 0, offset = 0) {
    const arr = new Uint8Array(byteSize);
    for (let i = 0; i < byteSize; ++i) {
      arr[i + offset] = (i ** 3 + i + start) % 251;
    }
    return arr;
  }

  /**
   * This is used for testing passing undefined members of `GPUImageDataLayout` instead of actual
   * values where possible. Passing arguments as values and not as objects so that they are passed
   * by copy and not by reference.
   */
  undefDataLayoutIfNeeded(
  offset,
  rowsPerImage,
  bytesPerRow,
  changeBeforePass)
  {
    if (changeBeforePass === 'undefined') {
      if (offset === 0) {
        offset = undefined;
      }
      if (bytesPerRow === 0) {
        bytesPerRow = undefined;
      }
      if (rowsPerImage === 0) {
        rowsPerImage = undefined;
      }
    }
    return { offset, bytesPerRow, rowsPerImage };
  }

  /**
   * This is used for testing passing undefined members of `GPUImageCopyTexture` instead of actual
   * values where possible and also for testing passing the origin as `[number, number, number]`.
   * Passing arguments as values and not as objects so that they are passed by copy and not by
   * reference.
   */
  undefOrArrayCopyViewIfNeeded(
  texture,
  origin_x,
  origin_y,
  origin_z,
  mipLevel,
  changeBeforePass)
  {
    let origin = { x: origin_x, y: origin_y, z: origin_z };

    if (changeBeforePass === 'undefined') {
      if (origin_x === 0 && origin_y === 0 && origin_z === 0) {
        origin = undefined;
      } else {
        if (origin_x === 0) {
          origin_x = undefined;
        }
        if (origin_y === 0) {
          origin_y = undefined;
        }
        if (origin_z === 0) {
          origin_z = undefined;
        }
        origin = { x: origin_x, y: origin_y, z: origin_z };
      }

      if (mipLevel === 0) {
        mipLevel = undefined;
      }
    }

    if (changeBeforePass === 'arrays') {
      origin = [origin_x, origin_y, origin_z];
    }

    return { texture, origin, mipLevel };
  }

  /**
   * This is used for testing passing `GPUExtent3D` as `[number, number, number]` instead of
   * `GPUExtent3DDict`. Passing arguments as values and not as objects so that they are passed by
   * copy and not by reference.
   */
  arrayCopySizeIfNeeded(
  width,
  height,
  depthOrArrayLayers,
  changeBeforePass)
  {
    if (changeBeforePass === 'arrays') {
      return [width, height, depthOrArrayLayers];
    } else {
      return { width, height, depthOrArrayLayers };
    }
  }

  /** Run a CopyT2B command with appropriate arguments corresponding to `ChangeBeforePass` */
  copyTextureToBufferWithAppliedArguments(
  buffer,
  { offset, rowsPerImage, bytesPerRow },
  { width, height, depthOrArrayLayers },
  { texture, mipLevel, origin },
  changeBeforePass)
  {
    const { x, y, z } = origin;

    const appliedCopyView = this.undefOrArrayCopyViewIfNeeded(
    texture,
    x,
    y,
    z,
    mipLevel,
    changeBeforePass);

    const appliedDataLayout = this.undefDataLayoutIfNeeded(
    offset,
    rowsPerImage,
    bytesPerRow,
    changeBeforePass);

    const appliedCheckSize = this.arrayCopySizeIfNeeded(
    width,
    height,
    depthOrArrayLayers,
    changeBeforePass);


    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
    appliedCopyView,
    { buffer, ...appliedDataLayout },
    appliedCheckSize);

    this.device.queue.submit([encoder.finish()]);
  }

  /** Put data into a part of the texture with an appropriate method. */
  uploadLinearTextureDataToTextureSubBox(
  textureCopyView,
  textureDataLayout,
  copySize,
  partialData,
  method,
  changeBeforePass)
  {
    const { texture, mipLevel, origin } = textureCopyView;
    const { offset, rowsPerImage, bytesPerRow } = textureDataLayout;
    const { x, y, z } = origin;
    const { width, height, depthOrArrayLayers } = copySize;

    const appliedCopyView = this.undefOrArrayCopyViewIfNeeded(
    texture,
    x,
    y,
    z,
    mipLevel,
    changeBeforePass);

    const appliedDataLayout = this.undefDataLayoutIfNeeded(
    offset,
    rowsPerImage,
    bytesPerRow,
    changeBeforePass);

    const appliedCopySize = this.arrayCopySizeIfNeeded(
    width,
    height,
    depthOrArrayLayers,
    changeBeforePass);


    switch (method) {
      case 'WriteTexture':{
          this.device.queue.writeTexture(
          appliedCopyView,
          partialData,
          appliedDataLayout,
          appliedCopySize);


          break;
        }
      case 'CopyB2T':{
          const buffer = this.makeBufferWithContents(partialData, GPUBufferUsage.COPY_SRC);
          const encoder = this.device.createCommandEncoder();
          encoder.copyBufferToTexture(
          { buffer, ...appliedDataLayout },
          appliedCopyView,
          appliedCopySize);

          this.device.queue.submit([encoder.finish()]);

          break;
        }
      default:
        unreachable();}

  }

  /**
   * We check an appropriate part of the texture against the given data.
   * Used directly with PartialCopyT2B check method (for a subpart of the texture)
   * and by `copyWholeTextureToBufferAndCheckContentsWithUpdatedData` with FullCopyT2B check method
   * (for the whole texture). We also ensure that CopyT2B doesn't overwrite bytes it's not supposed
   * to if validateOtherBytesInBuffer is set to true.
   */
  copyPartialTextureToBufferAndCheckContents(
  { texture, mipLevel, origin },
  checkSize,
  format,
  expected,
  expectedDataLayout,
  changeBeforePass = 'none')
  {
    // The alignment is necessary because we need to copy and map data from this buffer.
    const bufferSize = align(expected.byteLength, 4);
    // The start value ensures generated data here doesn't match the expected data.
    const bufferData = this.generateData(bufferSize, 17);

    const buffer = this.makeBufferWithContents(
    bufferData,
    GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);


    this.copyTextureToBufferWithAppliedArguments(
    buffer,
    expectedDataLayout,
    checkSize,
    { texture, mipLevel, origin },
    changeBeforePass);


    this.updateLinearTextureDataSubBox(
    expectedDataLayout,
    expectedDataLayout,
    checkSize,
    origin,
    origin,
    format,
    bufferData,
    expected);


    this.expectGPUBufferValuesEqual(buffer, bufferData);
  }

  /**
   * Copies the whole texture into linear data stored in a buffer for further checks.
   *
   * Used for `copyWholeTextureToBufferAndCheckContentsWithUpdatedData`.
   */
  copyWholeTextureToNewBuffer(
  { texture, mipLevel },
  resultDataLayout)
  {
    const { mipSize, byteLength, bytesPerRow, rowsPerImage } = resultDataLayout;
    const buffer = this.device.createBuffer({
      size: align(byteLength, 4), // this is necessary because we need to copy and map data from this buffer
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });


    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
    { texture, mipLevel },
    { buffer, bytesPerRow, rowsPerImage },
    mipSize);

    this.device.queue.submit([encoder.finish()]);

    return buffer;
  }

  /**
   * Takes the data returned by `copyWholeTextureToNewBuffer` and updates it after a copy operation
   * on the texture by emulating the copy behaviour here directly.
   */
  updateLinearTextureDataSubBox(
  destinationDataLayout,
  sourceDataLayout,
  copySize,
  destinationOrigin,
  sourceOrigin,
  format,
  destination,
  source)
  {
    for (const texel of this.iterateBlockRows(copySize, sourceOrigin, format)) {
      const srcOffsetElements = this.getTexelOffsetInBytes(
      sourceDataLayout,
      format,
      texel,
      sourceOrigin);

      const dstOffsetElements = this.getTexelOffsetInBytes(
      destinationDataLayout,
      format,
      texel,
      destinationOrigin);

      const rowLength = bytesInACompleteRow(copySize.width, format);
      memcpy(
      { src: source, start: srcOffsetElements, length: rowLength },
      { dst: destination, start: dstOffsetElements });

    }
  }

  /**
   * Used for checking whether the whole texture was updated correctly by
   * `uploadLinearTextureDataToTextureSubpart`. Takes fullData returned by
   * `copyWholeTextureToNewBuffer` before the copy operation which is the original texture data,
   * then updates it with `updateLinearTextureDataSubpart` and checks the texture against the
   * updated data after the copy operation.
   */
  copyWholeTextureToBufferAndCheckContentsWithUpdatedData(
  { texture, mipLevel, origin },
  fullTextureCopyLayout,
  texturePartialDataLayout,
  copySize,
  format,
  fullData,
  partialData)
  {
    const { mipSize, bytesPerRow, rowsPerImage, byteLength } = fullTextureCopyLayout;
    const readbackPromise = this.readGPUBufferRangeTyped(fullData, {
      type: Uint8Array,
      typedLength: byteLength });


    const destinationOrigin = { x: 0, y: 0, z: 0 };

    // We add an eventual async expectation which will update the full data and then add
    // other eventual async expectations to ensure it will be correct.
    this.eventualAsyncExpectation(async () => {
      const readback = await readbackPromise;
      this.updateLinearTextureDataSubBox(
      { offset: 0, ...fullTextureCopyLayout },
      texturePartialDataLayout,
      copySize,
      destinationOrigin,
      origin,
      format,
      readback.data,
      partialData);

      this.copyPartialTextureToBufferAndCheckContents(
      { texture, mipLevel, origin: destinationOrigin },
      { width: mipSize[0], height: mipSize[1], depthOrArrayLayers: mipSize[2] },
      format,
      readback.data,
      { bytesPerRow, rowsPerImage, offset: 0 });

      readback.cleanup();
    });
  }

  /**
   * Tests copy between linear data and texture by creating a texture, putting some data into it
   * with WriteTexture/CopyB2T, then getting data for the whole texture/for a part of it back and
   * comparing it with the expectation.
   */
  uploadTextureAndVerifyCopy({
    textureDataLayout,
    copySize,
    dataSize,
    mipLevel = 0,
    origin = { x: 0, y: 0, z: 0 },
    textureSize,
    format,
    dimension,
    initMethod,
    checkMethod,
    changeBeforePass = 'none' })












  {
    const texture = this.device.createTexture({
      size: textureSize,
      format,
      dimension,
      mipLevelCount: mipLevel + 1,
      usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });


    const data = this.generateData(dataSize);

    switch (checkMethod) {
      case 'PartialCopyT2B':{
          this.uploadLinearTextureDataToTextureSubBox(
          { texture, mipLevel, origin },
          textureDataLayout,
          copySize,
          data,
          initMethod,
          changeBeforePass);


          this.copyPartialTextureToBufferAndCheckContents(
          { texture, mipLevel, origin },
          copySize,
          format,
          data,
          textureDataLayout,
          changeBeforePass);


          break;
        }
      case 'FullCopyT2B':{
          const fullTextureCopyLayout = getTextureCopyLayout(format, dimension, textureSize, {
            mipLevel });


          const fullData = this.copyWholeTextureToNewBuffer(
          { texture, mipLevel },
          fullTextureCopyLayout);


          this.uploadLinearTextureDataToTextureSubBox(
          { texture, mipLevel, origin },
          textureDataLayout,
          copySize,
          data,
          initMethod,
          changeBeforePass);


          this.copyWholeTextureToBufferAndCheckContentsWithUpdatedData(
          { texture, mipLevel, origin },
          fullTextureCopyLayout,
          textureDataLayout,
          copySize,
          format,
          fullData,
          data);


          break;
        }
      default:
        unreachable();}

  }

  async DoUploadToStencilTest(
  format,
  textureSize,
  uploadMethod,
  bytesPerRow,
  rowsPerImage,
  initialDataSize,
  initialDataOffset,
  mipLevel)
  {
    const srcTexture = this.device.createTexture({
      size: textureSize,
      usage:
      GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
      format,
      mipLevelCount: mipLevel + 1 });


    const copySize = [textureSize[0] >> mipLevel, textureSize[1] >> mipLevel, textureSize[2]];
    const initialData = this.generateData(
    align(initialDataSize, kBufferSizeAlignment),
    0,
    initialDataOffset);

    switch (uploadMethod) {
      case 'WriteTexture':
        this.queue.writeTexture(
        { texture: srcTexture, aspect: 'stencil-only', mipLevel },
        initialData,
        {
          offset: initialDataOffset,
          bytesPerRow,
          rowsPerImage },

        copySize);

        break;
      case 'CopyB2T':
        {
          const stagingBuffer = makeBufferWithContents(
          this.device,
          initialData,
          GPUBufferUsage.COPY_SRC);

          const encoder = this.device.createCommandEncoder();
          encoder.copyBufferToTexture(
          { buffer: stagingBuffer, offset: initialDataOffset, bytesPerRow, rowsPerImage },
          { texture: srcTexture, aspect: 'stencil-only', mipLevel },
          copySize);

          this.queue.submit([encoder.finish()]);
        }
        break;
      default:
        unreachable();}


    await this.checkStencilTextureContent(
    srcTexture,
    textureSize,
    format,
    initialData,
    initialDataOffset,
    bytesPerRow,
    rowsPerImage,
    mipLevel);

  }

  async DoCopyFromStencilTest(
  format,
  textureSize,
  bytesPerRow,
  rowsPerImage,
  offset,
  mipLevel)
  {
    const srcTexture = this.device.createTexture({
      size: textureSize,
      usage:
      GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
      format,
      mipLevelCount: mipLevel + 1 });


    // Initialize srcTexture with queue.writeTexture()
    const copySize = [textureSize[0] >> mipLevel, textureSize[1] >> mipLevel, textureSize[2]];
    const initialData = this.generateData(
    align(copySize[0] * copySize[1] * copySize[2], kBufferSizeAlignment));

    this.queue.writeTexture(
    { texture: srcTexture, aspect: 'stencil-only', mipLevel },
    initialData,
    { bytesPerRow: copySize[0], rowsPerImage: copySize[1] },
    copySize);


    // Copy the stencil aspect from srcTexture into outputBuffer.
    const outputBufferSize = align(
    offset +
    dataBytesForCopyOrFail({
      layout: { bytesPerRow, rowsPerImage },
      format: 'stencil8',
      copySize,
      method: 'CopyT2B' }),

    kBufferSizeAlignment);

    const outputBuffer = this.device.createBuffer({
      size: outputBufferSize,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });

    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
    { texture: srcTexture, aspect: 'stencil-only', mipLevel },
    { buffer: outputBuffer, offset, bytesPerRow, rowsPerImage },
    copySize);

    this.queue.submit([encoder.finish()]);

    // Validate the data in outputBuffer is what we expect.
    const expectedData = new Uint8Array(outputBufferSize);
    for (let z = 0; z < copySize[2]; ++z) {
      const baseExpectedOffset = offset + z * bytesPerRow * rowsPerImage;
      const baseInitialDataOffset = z * copySize[0] * copySize[1];
      for (let y = 0; y < copySize[1]; ++y) {
        memcpy(
        {
          src: initialData,
          start: baseInitialDataOffset + y * copySize[0],
          length: copySize[0] },

        { dst: expectedData, start: baseExpectedOffset + y * bytesPerRow });

      }
    }
    this.expectGPUBufferValuesEqual(outputBuffer, expectedData);
  }

  // MAINTENANCE_TODO(#881): Migrate this into the texture_ok helpers.
  async checkStencilTextureContent(
  stencilTexture,
  stencilTextureSize,
  stencilTextureFormat,
  expectedStencilTextureData,
  expectedStencilTextureDataOffset,
  expectedStencilTextureDataBytesPerRow,
  expectedStencilTextureDataRowsPerImage,
  stencilTextureMipLevel)
  {
    const stencilBitCount = 8;

    // Prepare the uniform buffer that stores the bit indices (from 0 to 7) at stride 256 (required
    // by Dynamic Buffer Offset).
    const uniformBufferSize = kMinDynamicBufferOffsetAlignment * (stencilBitCount - 1) + 4;
    const uniformBufferData = new Uint32Array(uniformBufferSize / 4);
    for (let i = 1; i < stencilBitCount; ++i) {
      uniformBufferData[kMinDynamicBufferOffsetAlignment / 4 * i] = i;
    }
    const uniformBuffer = makeBufferWithContents(
    this.device,
    uniformBufferData,
    GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM);


    // Prepare the base render pipeline descriptor (all the settings expect stencilReadMask).
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: {
          type: 'uniform',
          minBindingSize: 4,
          hasDynamicOffset: true } }] });




    const renderPipelineDescriptorBase = {
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: this.device.createShaderModule({
          code: `
            @stage(vertex)
            fn main(@builtin(vertex_index) VertexIndex : u32)-> @builtin(position) vec4<f32> {
              var pos : array<vec2<f32>, 6> = array<vec2<f32>, 6>(
                  vec2<f32>(-1.0,  1.0),
                  vec2<f32>(-1.0, -1.0),
                  vec2<f32>( 1.0,  1.0),
                  vec2<f32>(-1.0, -1.0),
                  vec2<f32>( 1.0,  1.0),
                  vec2<f32>( 1.0, -1.0));
              return vec4<f32>(pos[VertexIndex], 0.0, 1.0);
            }` }),

        entryPoint: 'main' },


      fragment: {
        module: this.device.createShaderModule({
          code: `
            struct Params {
              stencilBitIndex: u32
            };
            @group(0) @binding(0) var<uniform> param: Params;
            @stage(fragment)
            fn main() -> @location(0) vec4<f32> {
              return vec4<f32>(f32(1u << param.stencilBitIndex) / 255.0, 0.0, 0.0, 0.0);
            }` }),

        entryPoint: 'main',
        targets: [
        {
          // As we implement "rendering one bit in each draw() call" with blending operation
          // 'add', the format of outputTexture must support blending.
          format: 'r8unorm',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: {} } }] },





      primitive: {
        topology: 'triangle-list' },


      depthStencil: {
        format: stencilTextureFormat,
        stencilFront: {
          compare: 'equal' },

        stencilBack: {
          compare: 'equal' } } };




    // Prepare the bindGroup that contains uniformBuffer and referenceTexture.
    const bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
      {
        binding: 0,
        resource: {
          buffer: uniformBuffer,
          size: 4 } }] });





    // "Copy" the stencil value into the color attachment with 8 draws in one render pass. Each draw
    // will "Copy" one bit of the stencil value into the color attachment. The bit of the stencil
    // value is specified by setStencilReference().
    const copyFromOutputTextureLayout = getTextureCopyLayout(
    stencilTextureFormat,
    '2d',
    [stencilTextureSize[0], stencilTextureSize[1], 1],
    {
      mipLevel: stencilTextureMipLevel,
      aspect: 'stencil-only' });


    const outputTextureSize = [
    copyFromOutputTextureLayout.mipSize[0],
    copyFromOutputTextureLayout.mipSize[1],
    1];

    const outputTexture = this.device.createTexture({
      format: 'r8unorm',
      size: outputTextureSize,
      usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT });


    for (
    let stencilTextureLayer = 0;
    stencilTextureLayer < stencilTextureSize[2];
    ++stencilTextureLayer)
    {
      const encoder = this.device.createCommandEncoder();
      const depthStencilAttachment = {
        view: stencilTexture.createView({
          baseMipLevel: stencilTextureMipLevel,
          mipLevelCount: 1,
          baseArrayLayer: stencilTextureLayer,
          arrayLayerCount: 1 }) };


      if (kTextureFormatInfo[stencilTextureFormat].depth) {
        depthStencilAttachment.depthClearValue = 0;
        depthStencilAttachment.depthLoadOp = 'clear';
        depthStencilAttachment.depthStoreOp = 'store';
      }
      if (kTextureFormatInfo[stencilTextureFormat].stencil) {
        depthStencilAttachment.stencilLoadOp = 'load';
        depthStencilAttachment.stencilStoreOp = 'store';
      }
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [
        {
          view: outputTexture.createView(),
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
          loadOp: 'clear',
          storeOp: 'store' }],


        depthStencilAttachment });


      for (let stencilBitIndex = 0; stencilBitIndex < stencilBitCount; ++stencilBitIndex) {
        const renderPipelineDescriptor = renderPipelineDescriptorBase;
        assert(renderPipelineDescriptor.depthStencil !== undefined);
        renderPipelineDescriptor.depthStencil.stencilReadMask = 1 << stencilBitIndex;
        const renderPipeline = this.device.createRenderPipeline(renderPipelineDescriptor);

        renderPass.setPipeline(renderPipeline);
        renderPass.setStencilReference(1 << stencilBitIndex);
        renderPass.setBindGroup(0, bindGroup, [stencilBitIndex * kMinDynamicBufferOffsetAlignment]);
        renderPass.draw(6);
      }
      renderPass.end();

      // Check outputTexture by copying the content of outputTexture into outputStagingBuffer and
      // checking all the data in outputStagingBuffer.
      const outputStagingBuffer = this.device.createBuffer({
        size: copyFromOutputTextureLayout.byteLength,
        usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });

      encoder.copyTextureToBuffer(
      {
        texture: outputTexture },

      {
        buffer: outputStagingBuffer,
        bytesPerRow: copyFromOutputTextureLayout.bytesPerRow,
        rowsPerImage: copyFromOutputTextureLayout.rowsPerImage },

      outputTextureSize);


      this.queue.submit([encoder.finish()]);

      // Check the valid data in outputStagingBuffer once per row.
      for (let y = 0; y < copyFromOutputTextureLayout.mipSize[1]; ++y) {
        this.expectGPUBufferValuesEqual(
        outputStagingBuffer,
        expectedStencilTextureData.slice(
        expectedStencilTextureDataOffset +
        expectedStencilTextureDataBytesPerRow *
        expectedStencilTextureDataRowsPerImage *
        stencilTextureLayer +
        expectedStencilTextureDataBytesPerRow * y,
        copyFromOutputTextureLayout.mipSize[0]));


      }
    }
  }

  // MAINTENANCE_TODO(#881): Consider if this can be simplified/encapsulated using TexelView.
  initializeDepthAspectWithRendering(
  depthTexture,
  depthFormat,
  copySize,
  copyMipLevel,
  initialData)
  {
    assert(kTextureFormatInfo[depthFormat].depth);

    const inputTexture = this.device.createTexture({
      size: copySize,
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      format: 'r32float' });

    this.queue.writeTexture(
    { texture: inputTexture },
    initialData,
    {
      bytesPerRow: copySize[0] * 4,
      rowsPerImage: copySize[1] },

    copySize);


    const renderPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: this.device.createShaderModule({
          code: `
          @stage(vertex)
          fn main(@builtin(vertex_index) VertexIndex : u32)-> @builtin(position) vec4<f32> {
            var pos : array<vec2<f32>, 6> = array<vec2<f32>, 6>(
                vec2<f32>(-1.0,  1.0),
                vec2<f32>(-1.0, -1.0),
                vec2<f32>( 1.0,  1.0),
                vec2<f32>(-1.0, -1.0),
                vec2<f32>( 1.0,  1.0),
                vec2<f32>( 1.0, -1.0));
            return vec4<f32>(pos[VertexIndex], 0.0, 1.0);
          }` }),

        entryPoint: 'main' },

      fragment: {
        module: this.device.createShaderModule({
          code: `
            @group(0) @binding(0) var inputTexture: texture_2d<f32>;
            @stage(fragment) fn main(@builtin(position) fragcoord : vec4<f32>) ->
              @builtin(frag_depth) f32 {
              var depthValue : vec4<f32> = textureLoad(inputTexture, vec2<i32>(fragcoord.xy), 0);
              return depthValue.x;
            }` }),

        entryPoint: 'main',
        targets: [] },

      primitive: {
        topology: 'triangle-list' },

      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: true,
        depthCompare: 'always' } });



    const encoder = this.device.createCommandEncoder();
    for (let z = 0; z < copySize[2]; ++z) {
      const depthStencilAttachment = {
        view: depthTexture.createView({
          dimension: '2d',
          baseArrayLayer: z,
          arrayLayerCount: 1,
          baseMipLevel: copyMipLevel,
          mipLevelCount: 1 }) };


      if (kTextureFormatInfo[depthFormat].depth) {
        depthStencilAttachment.depthClearValue = 0.0;
        depthStencilAttachment.depthLoadOp = 'clear';
        depthStencilAttachment.depthStoreOp = 'store';
      }
      if (kTextureFormatInfo[depthFormat].stencil) {
        depthStencilAttachment.stencilLoadOp = 'load';
        depthStencilAttachment.stencilStoreOp = 'store';
      }
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment });

      renderPass.setPipeline(renderPipeline);

      const bindGroup = this.device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
        {
          binding: 0,
          resource: inputTexture.createView({
            dimension: '2d',
            baseArrayLayer: z,
            arrayLayerCount: 1,
            baseMipLevel: 0,
            mipLevelCount: 1 }) }] });




      renderPass.setBindGroup(0, bindGroup);
      renderPass.draw(6);
      renderPass.end();
    }

    this.queue.submit([encoder.finish()]);
  }

  DoCopyTextureToBufferWithDepthAspectTest(
  format,
  copySize,
  bytesPerRowPadding,
  rowsPerImagePadding,
  offset,
  dataPaddingInBytes,
  mipLevel)
  {
    // [2]: need to convert the float32 values in initialData into the ones compatible
    // to the depth aspect of depthFormats when depth16unorm is supported by the browsers.

    // Generate the initial depth data uploaded to the texture as float32.
    const initialData = new Float32Array(copySize[0] * copySize[1] * copySize[2]);
    for (let i = 0; i < initialData.length; ++i) {
      const baseValue = 0.05 * i;

      // We expect there are both 1's and 0's in initialData.
      initialData[i] = i % 40 === 0 ? 1 : baseValue - Math.floor(baseValue);
      assert(initialData[i] >= 0 && initialData[i] <= 1);
    }

    // The data uploaded to the texture, using the byte pattern of the format.
    let formatInitialData = initialData;

    // For unorm depth formats, replace the uploaded depth data with quantized data to avoid
    // rounding issues when converting from 32float to 16unorm.
    if (format === 'depth16unorm') {
      const u16Data = new Uint16Array(initialData.length);
      for (let i = 0; i < initialData.length; i++) {
        u16Data[i] = initialData[i] * 65535;
        initialData[i] = u16Data[i] / 65535.0;
      }
      formatInitialData = u16Data;
    }

    // Initialize the depth aspect of the source texture
    const depthTexture = this.device.createTexture({
      format,
      size: [copySize[0] << mipLevel, copySize[1] << mipLevel, copySize[2]],
      usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
      mipLevelCount: mipLevel + 1 });

    this.initializeDepthAspectWithRendering(depthTexture, format, copySize, mipLevel, initialData);

    // Copy the depth aspect of the texture into the destination buffer.
    const aspectBytesPerBlock = depthStencilFormatAspectSize(format, 'depth-only');
    const bytesPerRow =
    align(aspectBytesPerBlock * copySize[0], kBytesPerRowAlignment) +
    bytesPerRowPadding * kBytesPerRowAlignment;
    const rowsPerImage = copySize[1] + rowsPerImagePadding;

    const destinationBufferSize = align(
    bytesPerRow * rowsPerImage * copySize[2] +
    bytesPerRow * (copySize[1] - 1) +
    aspectBytesPerBlock * copySize[0] +
    offset +
    dataPaddingInBytes,
    kBufferSizeAlignment);

    const destinationBuffer = this.device.createBuffer({
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      size: destinationBufferSize });

    const copyEncoder = this.device.createCommandEncoder();
    copyEncoder.copyTextureToBuffer(
    {
      texture: depthTexture,
      mipLevel,
      aspect: 'depth-only' },

    {
      buffer: destinationBuffer,
      offset,
      bytesPerRow,
      rowsPerImage },

    copySize);

    this.queue.submit([copyEncoder.finish()]);

    // Validate the data in destinationBuffer is what we expect.
    const expectedData = new Uint8Array(destinationBufferSize);
    for (let z = 0; z < copySize[2]; ++z) {
      const baseExpectedOffset = z * bytesPerRow * rowsPerImage + offset;
      const baseInitialDataOffset = z * copySize[0] * copySize[1];
      for (let y = 0; y < copySize[1]; ++y) {
        memcpy(
        {
          src: formatInitialData,
          start: baseInitialDataOffset + y * copySize[0],
          length: copySize[0] },

        { dst: expectedData, start: baseExpectedOffset + y * bytesPerRow });

      }
    }
    this.expectGPUBufferValuesEqual(destinationBuffer, expectedData);
  }}


/**
 * This is a helper function used for filtering test parameters
 *
 * [3]: Modify this after introducing tests with rendering.
 */
function formatCanBeTested({ format }) {
  return kTextureFormatInfo[format].copyDst && kTextureFormatInfo[format].copySrc;
}

export const g = makeTestGroup(ImageCopyTest);

const kRowsPerImageAndBytesPerRowParams = {
  paddings: [
  { bytesPerRowPadding: 0, rowsPerImagePadding: 0 }, // no padding
  { bytesPerRowPadding: 0, rowsPerImagePadding: 6 }, // rowsPerImage padding
  { bytesPerRowPadding: 6, rowsPerImagePadding: 0 }, // bytesPerRow padding
  { bytesPerRowPadding: 15, rowsPerImagePadding: 17 } // both paddings
  ],

  copySizes: [
  // In the two cases below, for (WriteTexture, PartialCopyB2T) and (CopyB2T, FullCopyT2B)
  // sets of methods we will have bytesPerRow = 256 and copyDepth % 2 == { 0, 1 }
  // respectively. This covers a special code path for D3D12.
  { copyWidthInBlocks: 3, copyHeightInBlocks: 4, copyDepth: 5 }, // standard copy
  { copyWidthInBlocks: 5, copyHeightInBlocks: 4, copyDepth: 2 }, // standard copy

  { copyWidthInBlocks: 0, copyHeightInBlocks: 4, copyDepth: 5 }, // empty copy because of width
  { copyWidthInBlocks: 3, copyHeightInBlocks: 0, copyDepth: 5 }, // empty copy because of height
  { copyWidthInBlocks: 3, copyHeightInBlocks: 4, copyDepth: 0 }, // empty copy because of depthOrArrayLayers
  { copyWidthInBlocks: 256, copyHeightInBlocks: 3, copyDepth: 2 }, // copyWidth is 256-aligned
  { copyWidthInBlocks: 1, copyHeightInBlocks: 3, copyDepth: 5 }, // copyWidth = 1

  // The two cases below cover another special code path for D3D12.
  //   - For (WriteTexture, FullCopyT2B) with r8unorm:
  //         bytesPerRow = 15 = 3 * 5 = bytesInACompleteCopyImage.
  { copyWidthInBlocks: 32, copyHeightInBlocks: 1, copyDepth: 8 }, // copyHeight = 1
  //   - For (CopyB2T, FullCopyT2B) and (WriteTexture, PartialCopyT2B) with r8unorm:
  //         bytesPerRow = 256 = 8 * 32 = bytesInACompleteCopyImage.
  { copyWidthInBlocks: 5, copyHeightInBlocks: 4, copyDepth: 1 }, // copyDepth = 1

  { copyWidthInBlocks: 7, copyHeightInBlocks: 1, copyDepth: 1 } // copyHeight = 1 and copyDepth = 1
  ],

  // Copy sizes that are suitable for 1D texture and check both some copy sizes and empty copies.
  copySizes1D: [
  { copyWidthInBlocks: 3, copyHeightInBlocks: 1, copyDepth: 1 },
  { copyWidthInBlocks: 5, copyHeightInBlocks: 1, copyDepth: 1 },

  { copyWidthInBlocks: 3, copyHeightInBlocks: 0, copyDepth: 1 },
  { copyWidthInBlocks: 0, copyHeightInBlocks: 1, copyDepth: 1 },
  { copyWidthInBlocks: 5, copyHeightInBlocks: 1, copyDepth: 0 }] };



g.test('rowsPerImage_and_bytesPerRow').
desc(
`Test that copying data with various bytesPerRow and rowsPerImage values and minimum required
bytes in copy works for every format.

  Covers a special code path for Metal:
    bufferSize - offset < bytesPerImage * copyExtent.depthOrArrayLayers
  Covers a special code path for D3D12:
    when bytesPerRow is not a multiple of 512 and copyExtent.depthOrArrayLayers > 1: copyExtent.depthOrArrayLayers % 2 == { 0, 1 }
    bytesPerRow == bytesInACompleteCopyImage

  TODO: Cover the special code paths for 3D textures in D3D12.
  `).

params((u) =>
u.
combineWithParams(kMethodsToTest).
combine('format', kWorkingColorTextureFormats).
filter(formatCanBeTested).
combine('dimension', kTextureDimensions).
filter(({ dimension, format }) => textureDimensionAndFormatCompatible(dimension, format)).
beginSubcases().
combineWithParams(kRowsPerImageAndBytesPerRowParams.paddings).
expandWithParams((p) => {
  if (p.dimension === '1d') {
    return kRowsPerImageAndBytesPerRowParams.copySizes1D;
  }
  return kRowsPerImageAndBytesPerRowParams.copySizes;
})).

beforeAllSubcases((t) => {
  const info = kTextureFormatInfo[t.params.format];
  t.selectDeviceOrSkipTestCase(info.feature);
}).
fn(async (t) => {
  const {
    bytesPerRowPadding,
    rowsPerImagePadding,
    copyWidthInBlocks,
    copyHeightInBlocks,
    copyDepth,
    format,
    dimension,
    initMethod,
    checkMethod } =
  t.params;
  const info = kTextureFormatInfo[format];
  // For CopyB2T and CopyT2B we need to have bytesPerRow 256-aligned,
  // to make this happen we align the bytesInACompleteRow value and multiply
  // bytesPerRowPadding by 256.
  const bytesPerRowAlignment =
  initMethod === 'WriteTexture' && checkMethod === 'FullCopyT2B' ? 1 : 256;

  const copyWidth = copyWidthInBlocks * info.blockWidth;
  const copyHeight = copyHeightInBlocks * info.blockHeight;
  const rowsPerImage = copyHeightInBlocks + rowsPerImagePadding;
  const bytesPerRow =
  align(bytesInACompleteRow(copyWidth, format), bytesPerRowAlignment) +
  bytesPerRowPadding * bytesPerRowAlignment;
  const copySize = { width: copyWidth, height: copyHeight, depthOrArrayLayers: copyDepth };

  const dataSize = dataBytesForCopyOrFail({
    layout: { offset: 0, bytesPerRow, rowsPerImage },
    format,
    copySize,
    method: initMethod });


  t.uploadTextureAndVerifyCopy({
    textureDataLayout: { offset: 0, bytesPerRow, rowsPerImage },
    copySize,
    dataSize,
    textureSize: [
    Math.max(copyWidth, info.blockWidth),
    Math.max(copyHeight, info.blockHeight),
    Math.max(copyDepth, 1)]
    /* making sure the texture is non-empty */,
    format,
    dimension,
    initMethod,
    checkMethod });

});

const kOffsetsAndSizesParams = {
  offsetsAndPaddings: [
  { offsetInBlocks: 0, dataPaddingInBytes: 0 }, // no offset and no padding
  { offsetInBlocks: 1, dataPaddingInBytes: 0 }, // offset = 1
  { offsetInBlocks: 2, dataPaddingInBytes: 0 }, // offset = 2
  { offsetInBlocks: 15, dataPaddingInBytes: 0 }, // offset = 15
  { offsetInBlocks: 16, dataPaddingInBytes: 0 }, // offset = 16
  { offsetInBlocks: 242, dataPaddingInBytes: 0 }, // for rgba8unorm format: offset + bytesInCopyExtentPerRow = 242 + 12 = 256 = bytesPerRow
  { offsetInBlocks: 243, dataPaddingInBytes: 0 }, // for rgba8unorm format: offset + bytesInCopyExtentPerRow = 243 + 12 > 256 = bytesPerRow
  { offsetInBlocks: 768, dataPaddingInBytes: 0 }, // for copyDepth = 1, blockWidth = 1 and bytesPerBlock = 1: offset = 768 = 3 * 256 = bytesInACompleteCopyImage
  { offsetInBlocks: 769, dataPaddingInBytes: 0 }, // for copyDepth = 1, blockWidth = 1 and bytesPerBlock = 1: offset = 769 > 768 = bytesInACompleteCopyImage
  { offsetInBlocks: 0, dataPaddingInBytes: 1 }, // dataPaddingInBytes > 0
  { offsetInBlocks: 1, dataPaddingInBytes: 8 } // offset > 0 and dataPaddingInBytes > 0
  ],
  copyDepth: [1, 2] };


g.test('offsets_and_sizes').
desc(
`Test that copying data with various offset values and additional data paddings
works for every format with 2d and 2d-array textures.

  Covers two special code paths for D3D12:
    offset + bytesInCopyExtentPerRow { ==, > } bytesPerRow
    offset > bytesInACompleteCopyImage

  TODO: Cover the special code paths for 3D textures in D3D12.
  TODO: Make a variant for depth-stencil formats.
`).

params((u) =>
u.
combineWithParams(kMethodsToTest).
combine('format', kWorkingColorTextureFormats).
filter(formatCanBeTested).
combine('dimension', kTextureDimensions).
filter(({ dimension, format }) => textureDimensionAndFormatCompatible(dimension, format)).
beginSubcases().
combineWithParams(kOffsetsAndSizesParams.offsetsAndPaddings).
combine('copyDepth', kOffsetsAndSizesParams.copyDepth) // 2d and 2d-array textures
.unless((p) => p.dimension === '1d' && p.copyDepth !== 1)).

beforeAllSubcases((t) => {
  const info = kTextureFormatInfo[t.params.format];
  t.selectDeviceOrSkipTestCase(info.feature);
}).
fn(async (t) => {
  const {
    offsetInBlocks,
    dataPaddingInBytes,
    copyDepth,
    format,
    dimension,
    initMethod,
    checkMethod } =
  t.params;
  const info = kTextureFormatInfo[format];

  const offset = offsetInBlocks * info.bytesPerBlock;
  const copySize = {
    width: 3 * info.blockWidth,
    height: 3 * info.blockHeight,
    depthOrArrayLayers: copyDepth };

  let textureHeight = 4 * info.blockHeight;
  let rowsPerImage = 3;
  const bytesPerRow = 256;

  if (dimension === '1d') {
    copySize.height = 1;
    textureHeight = info.blockHeight;
    rowsPerImage = 1;
  }
  const textureSize = [4 * info.blockWidth, textureHeight, copyDepth];

  const minDataSize = dataBytesForCopyOrFail({
    layout: { offset, bytesPerRow, rowsPerImage },
    format,
    copySize,
    method: initMethod });

  const dataSize = minDataSize + dataPaddingInBytes;

  // We're copying a (3 x 3 x copyDepth) (in texel blocks) part of a (4 x 4 x copyDepth)
  // (in texel blocks) texture with no origin.
  t.uploadTextureAndVerifyCopy({
    textureDataLayout: { offset, bytesPerRow, rowsPerImage },
    copySize,
    dataSize,
    textureSize,
    format,
    dimension,
    initMethod,
    checkMethod });

});

g.test('origins_and_extents').
desc(
`Test that copying slices of a texture works with various origin and copyExtent values
for all formats. We pass origin and copyExtent as [number, number, number].`).

params((u) =>
u.
combineWithParams(kMethodsToTest).
combine('format', kWorkingColorTextureFormats).
filter(formatCanBeTested).
combine('dimension', kTextureDimensions).
filter(({ dimension, format }) => textureDimensionAndFormatCompatible(dimension, format)).
beginSubcases().
combine('originValueInBlocks', [0, 7, 8]).
combine('copySizeValueInBlocks', [0, 7, 8]).
combine('textureSizePaddingValueInBlocks', [0, 7, 8]).
unless(
(p) =>
// we can't create an empty texture
p.copySizeValueInBlocks + p.originValueInBlocks + p.textureSizePaddingValueInBlocks === 0).

combine('coordinateToTest', [0, 1, 2]).
unless((p) => p.dimension === '1d' && p.coordinateToTest !== 0)).

beforeAllSubcases((t) => {
  const info = kTextureFormatInfo[t.params.format];
  t.selectDeviceOrSkipTestCase(info.feature);
}).
fn(async (t) => {
  const {
    originValueInBlocks,
    copySizeValueInBlocks,
    textureSizePaddingValueInBlocks,
    format,
    dimension,
    initMethod,
    checkMethod } =
  t.params;
  const info = kTextureFormatInfo[format];

  let originBlocks = [1, 1, 1];
  let copySizeBlocks = [2, 2, 2];
  let texSizeBlocks = [3, 3, 3];
  if (dimension === '1d') {
    originBlocks = [1, 0, 0];
    copySizeBlocks = [2, 1, 1];
    texSizeBlocks = [3, 1, 1];
  }

  {
    const ctt = t.params.coordinateToTest;
    originBlocks[ctt] = originValueInBlocks;
    copySizeBlocks[ctt] = copySizeValueInBlocks;
    texSizeBlocks[ctt] =
    originBlocks[ctt] + copySizeBlocks[ctt] + textureSizePaddingValueInBlocks;
  }

  const origin = {
    x: originBlocks[0] * info.blockWidth,
    y: originBlocks[1] * info.blockHeight,
    z: originBlocks[2] };

  const copySize = {
    width: copySizeBlocks[0] * info.blockWidth,
    height: copySizeBlocks[1] * info.blockHeight,
    depthOrArrayLayers: copySizeBlocks[2] };

  const textureSize = [
  texSizeBlocks[0] * info.blockWidth,
  texSizeBlocks[1] * info.blockHeight,
  texSizeBlocks[2]];


  const rowsPerImage = copySizeBlocks[1];
  const bytesPerRow = align(copySizeBlocks[0] * info.bytesPerBlock, 256);

  const dataSize = dataBytesForCopyOrFail({
    layout: { offset: 0, bytesPerRow, rowsPerImage },
    format,
    copySize,
    method: initMethod });


  // For testing width: we copy a (_ x 2 x 2) (in texel blocks) part of a (_ x 3 x 3)
  // (in texel blocks) texture with origin (_, 1, 1) (in texel blocks).
  // Similarly for other coordinates.
  t.uploadTextureAndVerifyCopy({
    textureDataLayout: { offset: 0, bytesPerRow, rowsPerImage },
    copySize,
    dataSize,
    origin,
    textureSize,
    format,
    dimension,
    initMethod,
    checkMethod,
    changeBeforePass: 'arrays' });

});

/**
 * Generates textureSizes which correspond to the same physicalSizeAtMipLevel including virtual
 * sizes at mip level different from the physical ones.
 */
function* generateTestTextureSizes({
  format,
  dimension,
  mipLevel,
  _mipSizeInBlocks })





{
  assert(dimension !== '1d'); // textureSize[1] would be wrong for 1D mipped textures.
  const info = kTextureFormatInfo[format];

  const widthAtThisLevel = _mipSizeInBlocks.width * info.blockWidth;
  const heightAtThisLevel = _mipSizeInBlocks.height * info.blockHeight;
  const textureSize = [
  widthAtThisLevel << mipLevel,
  heightAtThisLevel << mipLevel,
  _mipSizeInBlocks.depthOrArrayLayers << (dimension === '3d' ? mipLevel : 0)];

  yield textureSize;

  // We choose width and height of the texture so that the values are divisible by blockWidth and
  // blockHeight respectively and so that the virtual size at mip level corresponds to the same
  // physical size.
  // Virtual size at mip level with modified width has width = (physical size width) - (blockWidth / 2).
  // Virtual size at mip level with modified height has height = (physical size height) - (blockHeight / 2).
  const widthAtPrevLevel = widthAtThisLevel << 1;
  const heightAtPrevLevel = heightAtThisLevel << 1;
  assert(mipLevel > 0);
  assert(widthAtPrevLevel >= info.blockWidth && heightAtPrevLevel >= info.blockHeight);
  const modifiedWidth = widthAtPrevLevel - info.blockWidth << mipLevel - 1;
  const modifiedHeight = heightAtPrevLevel - info.blockHeight << mipLevel - 1;

  const modifyWidth = info.blockWidth > 1 && modifiedWidth !== textureSize[0];
  const modifyHeight = info.blockHeight > 1 && modifiedHeight !== textureSize[1];

  if (modifyWidth) {
    yield [modifiedWidth, textureSize[1], textureSize[2]];
  }
  if (modifyHeight) {
    yield [textureSize[0], modifiedHeight, textureSize[2]];
  }
  if (modifyWidth && modifyHeight) {
    yield [modifiedWidth, modifiedHeight, textureSize[2]];
  }

  if (dimension === '3d') {
    yield [textureSize[0], textureSize[1], textureSize[2] + 1];
  }
}

g.test('mip_levels').
desc(
`Test that copying various mip levels works. Covers two special code paths:
  - The physical size of the subresource is not equal to the logical size.
  - bufferSize - offset < bytesPerImage * copyExtent.depthOrArrayLayers, and copyExtent needs to be clamped for all block formats.
  - For 3D textures test copying to a sub-range of the depth.

Tests both 2D and 3D textures. 1D textures are skipped because they can only have one mip level.

TODO: Make a variant for depth-stencil formats.
  `).

params((u) =>
u.
combineWithParams(kMethodsToTest).
combine('format', kWorkingColorTextureFormats).
filter(formatCanBeTested).
combine('dimension', ['2d', '3d']).
filter(({ dimension, format }) => textureDimensionAndFormatCompatible(dimension, format)).
beginSubcases().
combineWithParams([
// origin + copySize = texturePhysicalSizeAtMipLevel for all coordinates, 2d texture */
{
  copySizeInBlocks: { width: 5, height: 4, depthOrArrayLayers: 1 },
  originInBlocks: { x: 3, y: 2, z: 0 },
  _mipSizeInBlocks: { width: 8, height: 6, depthOrArrayLayers: 1 },
  mipLevel: 1 },

// origin + copySize = texturePhysicalSizeAtMipLevel for all coordinates, 2d-array texture
{
  copySizeInBlocks: { width: 5, height: 4, depthOrArrayLayers: 2 },
  originInBlocks: { x: 3, y: 2, z: 1 },
  _mipSizeInBlocks: { width: 8, height: 6, depthOrArrayLayers: 3 },
  mipLevel: 2 },

// origin.x + copySize.width = texturePhysicalSizeAtMipLevel.width
{
  copySizeInBlocks: { width: 5, height: 4, depthOrArrayLayers: 2 },
  originInBlocks: { x: 3, y: 2, z: 1 },
  _mipSizeInBlocks: { width: 8, height: 7, depthOrArrayLayers: 4 },
  mipLevel: 3 },

// origin.y + copySize.height = texturePhysicalSizeAtMipLevel.height
{
  copySizeInBlocks: { width: 5, height: 4, depthOrArrayLayers: 2 },
  originInBlocks: { x: 3, y: 2, z: 1 },
  _mipSizeInBlocks: { width: 9, height: 6, depthOrArrayLayers: 4 },
  mipLevel: 4 },

// origin.z + copySize.depthOrArrayLayers = texturePhysicalSizeAtMipLevel.depthOrArrayLayers
{
  copySizeInBlocks: { width: 5, height: 4, depthOrArrayLayers: 2 },
  originInBlocks: { x: 3, y: 2, z: 1 },
  _mipSizeInBlocks: { width: 9, height: 7, depthOrArrayLayers: 3 },
  mipLevel: 4 },

// origin + copySize < texturePhysicalSizeAtMipLevel for all coordinates
{
  copySizeInBlocks: { width: 5, height: 4, depthOrArrayLayers: 2 },
  originInBlocks: { x: 3, y: 2, z: 1 },
  _mipSizeInBlocks: { width: 9, height: 7, depthOrArrayLayers: 4 },
  mipLevel: 4 }]).


expand('textureSize', generateTestTextureSizes)).

beforeAllSubcases((t) => {
  const info = kTextureFormatInfo[t.params.format];
  t.selectDeviceOrSkipTestCase(info.feature);
}).
fn(async (t) => {
  const {
    copySizeInBlocks,
    originInBlocks,
    textureSize,
    mipLevel,
    format,
    dimension,
    initMethod,
    checkMethod } =
  t.params;
  const info = kTextureFormatInfo[format];

  const origin = {
    x: originInBlocks.x * info.blockWidth,
    y: originInBlocks.y * info.blockHeight,
    z: originInBlocks.z };

  const copySize = {
    width: copySizeInBlocks.width * info.blockWidth,
    height: copySizeInBlocks.height * info.blockHeight,
    depthOrArrayLayers: copySizeInBlocks.depthOrArrayLayers };


  const rowsPerImage = copySizeInBlocks.height + 1;
  const bytesPerRow = align(copySize.width, 256);

  const dataSize = dataBytesForCopyOrFail({
    layout: { offset: 0, bytesPerRow, rowsPerImage },
    format,
    copySize,
    method: initMethod });


  t.uploadTextureAndVerifyCopy({
    textureDataLayout: { offset: 0, bytesPerRow, rowsPerImage },
    copySize,
    dataSize,
    origin,
    mipLevel,
    textureSize,
    format,
    dimension,
    initMethod,
    checkMethod });

});

const UND = undefined;
g.test('undefined_params').
desc(
`Tests undefined values of bytesPerRow, rowsPerImage, and origin.x/y/z.
  Ensures bytesPerRow/rowsPerImage=undefined are valid and behave as expected.
  Ensures origin.x/y/z undefined default to 0.`).

params((u) =>
u.
combineWithParams(kMethodsToTest).
combine('dimension', kTextureDimensions).
beginSubcases().
combineWithParams([
// copying one row: bytesPerRow and rowsPerImage can be undefined
{ copySize: [3, 1, 1], origin: [UND, UND, UND], bytesPerRow: UND, rowsPerImage: UND },
// copying one slice: rowsPerImage can be undefined
{ copySize: [3, 1, 1], origin: [UND, UND, UND], bytesPerRow: 256, rowsPerImage: UND },
{ copySize: [3, 3, 1], origin: [UND, UND, UND], bytesPerRow: 256, rowsPerImage: UND },
// copying two slices
{ copySize: [3, 3, 2], origin: [UND, UND, UND], bytesPerRow: 256, rowsPerImage: 3 },
// origin.x = undefined
{ copySize: [1, 1, 1], origin: [UND, 1, 1], bytesPerRow: UND, rowsPerImage: UND },
// origin.y = undefined
{ copySize: [1, 1, 1], origin: [1, UND, 1], bytesPerRow: UND, rowsPerImage: UND },
// origin.z = undefined
{ copySize: [1, 1, 1], origin: [1, 1, UND], bytesPerRow: UND, rowsPerImage: UND }]).

expandWithParams((p) => [
{
  _textureSize: [
  100,
  p.copySize[1] + (p.origin[1] ?? 0),
  p.copySize[2] + (p.origin[2] ?? 0)] }]).



unless((p) => p.dimension === '1d' && (p._textureSize[1] > 1 || p._textureSize[2] > 1))).

fn(async (t) => {
  const {
    dimension,
    _textureSize,
    bytesPerRow,
    rowsPerImage,
    copySize,
    origin,
    initMethod,
    checkMethod } =
  t.params;

  t.uploadTextureAndVerifyCopy({
    textureDataLayout: {
      offset: 0,
      // Zero will get turned back into undefined later.
      bytesPerRow: bytesPerRow ?? 0,
      // Zero will get turned back into undefined later.
      rowsPerImage: rowsPerImage ?? 0 },

    copySize: { width: copySize[0], height: copySize[1], depthOrArrayLayers: copySize[2] },
    dataSize: 2000,
    textureSize: _textureSize,
    // Zeros will get turned back into undefined later.
    origin: { x: origin[0] ?? 0, y: origin[1] ?? 0, z: origin[2] ?? 0 },
    format: 'rgba8unorm',
    dimension,
    initMethod,
    checkMethod,
    changeBeforePass: 'undefined' });

});

function CopyMethodSupportedWithDepthStencilFormat(
aspect,
format,
copyMethod)
{
  {
    return (
      aspect === 'stencil-only' && kTextureFormatInfo[format].stencil ||
      aspect === 'depth-only' &&
      kTextureFormatInfo[format].depth &&
      copyMethod === 'CopyT2B' &&
      depthStencilBufferTextureCopySupported('CopyT2B', format, aspect));

  }
}

g.test('rowsPerImage_and_bytesPerRow_depth_stencil').
desc(
`Test that copying data with various bytesPerRow and rowsPerImage values and minimum required
bytes in copy works for copyBufferToTexture(), copyTextureToBuffer() and writeTexture() with stencil
aspect and copyTextureToBuffer() with depth aspect.

  Covers a special code path for Metal:
    bufferSize - offset < bytesPerImage * copyExtent.depthOrArrayLayers
  Covers a special code path for D3D12:
    when bytesPerRow is not a multiple of 512 and copyExtent.depthOrArrayLayers > 1:
      copyExtent.depthOrArrayLayers % 2 == { 0, 1 }
      bytesPerRow == bytesInACompleteCopyImage
  `).

params((u) =>
u.
combine('format', kDepthStencilFormats).
combine('copyMethod', ['WriteTexture', 'CopyB2T', 'CopyT2B']).
combine('aspect', ['depth-only', 'stencil-only']).
filter((t) => CopyMethodSupportedWithDepthStencilFormat(t.aspect, t.format, t.copyMethod)).
beginSubcases().
combineWithParams(kRowsPerImageAndBytesPerRowParams.paddings).
combineWithParams(kRowsPerImageAndBytesPerRowParams.copySizes).
filter((t) => {
  return t.copyWidthInBlocks * t.copyHeightInBlocks * t.copyDepth > 0;
}).
combine('mipLevel', [0, 2])).

beforeAllSubcases((t) => {
  const info = kTextureFormatInfo[t.params.format];
  t.selectDeviceOrSkipTestCase(info.feature);
}).
fn(async (t) => {
  const {
    format,
    copyMethod,
    aspect,
    bytesPerRowPadding,
    rowsPerImagePadding,
    copyWidthInBlocks,
    copyHeightInBlocks,
    copyDepth,
    mipLevel } =
  t.params;
  const bytesPerBlock = depthStencilFormatAspectSize(format, aspect);
  const rowsPerImage = copyHeightInBlocks + rowsPerImagePadding;

  const bytesPerRowAlignment = copyMethod === 'WriteTexture' ? 1 : kBytesPerRowAlignment;
  const bytesPerRow =
  align(bytesPerBlock * copyWidthInBlocks, bytesPerRowAlignment) +
  bytesPerRowPadding * bytesPerRowAlignment;

  const copySize = [copyWidthInBlocks, copyHeightInBlocks, copyDepth];
  const textureSize = [
  copyWidthInBlocks << mipLevel,
  copyHeightInBlocks << mipLevel,
  copyDepth];

  if (copyMethod === 'CopyT2B') {
    if (aspect === 'depth-only') {
      t.DoCopyTextureToBufferWithDepthAspectTest(
      format,
      copySize,
      bytesPerRowPadding,
      rowsPerImagePadding,
      0,
      0,
      mipLevel);

    } else {
      await t.DoCopyFromStencilTest(format, textureSize, bytesPerRow, rowsPerImage, 0, mipLevel);
    }
  } else {
    assert(
    aspect === 'stencil-only' && (copyMethod === 'CopyB2T' || copyMethod === 'WriteTexture'));

    const initialDataSize = dataBytesForCopyOrFail({
      layout: { bytesPerRow, rowsPerImage },
      format: 'stencil8',
      copySize,
      method: copyMethod });


    await t.DoUploadToStencilTest(
    format,
    textureSize,
    copyMethod,
    bytesPerRow,
    rowsPerImage,
    initialDataSize,
    0,
    mipLevel);

  }
});

g.test('offsets_and_sizes_copy_depth_stencil').
desc(
`Test that copying data with various offset values and additional data paddings
works for copyBufferToTexture(), copyTextureToBuffer() and writeTexture() with stencil aspect and
copyTextureToBuffer() with depth aspect.

  Covers two special code paths for D3D12:
    offset + bytesInCopyExtentPerRow { ==, > } bytesPerRow
    offset > bytesInACompleteCopyImage
`).

params((u) =>
u.
combine('format', kDepthStencilFormats).
combine('copyMethod', ['WriteTexture', 'CopyB2T', 'CopyT2B']).
combine('aspect', ['depth-only', 'stencil-only']).
filter((t) => CopyMethodSupportedWithDepthStencilFormat(t.aspect, t.format, t.copyMethod)).
beginSubcases().
combineWithParams(kOffsetsAndSizesParams.offsetsAndPaddings).
filter((t) => t.offsetInBlocks % 4 === 0).
combine('copyDepth', kOffsetsAndSizesParams.copyDepth).
combine('mipLevel', [0, 2])).

beforeAllSubcases((t) => {
  const info = kTextureFormatInfo[t.params.format];
  t.selectDeviceOrSkipTestCase(info.feature);
}).
fn(async (t) => {
  const {
    format,
    copyMethod,
    aspect,
    offsetInBlocks,
    dataPaddingInBytes,
    copyDepth,
    mipLevel } =
  t.params;
  const bytesPerBlock = depthStencilFormatAspectSize(format, aspect);
  const initialDataOffset = offsetInBlocks * bytesPerBlock;
  const copySize = [3, 3, copyDepth];
  const rowsPerImage = 3;
  const bytesPerRow = 256;

  const textureSize = [copySize[0] << mipLevel, copySize[1] << mipLevel, copyDepth];
  if (copyMethod === 'CopyT2B') {
    if (aspect === 'depth-only') {
      t.DoCopyTextureToBufferWithDepthAspectTest(format, copySize, 0, 0, 0, 0, mipLevel);
    } else {
      await t.DoCopyFromStencilTest(
      format,
      textureSize,
      bytesPerRow,
      rowsPerImage,
      initialDataOffset,
      mipLevel);

    }
  } else {
    assert(
    aspect === 'stencil-only' && (copyMethod === 'CopyB2T' || copyMethod === 'WriteTexture'));

    const minDataSize = dataBytesForCopyOrFail({
      layout: { offset: initialDataOffset, bytesPerRow, rowsPerImage },
      format: 'stencil8',
      copySize,
      method: copyMethod });

    const initialDataSize = minDataSize + dataPaddingInBytes;
    await t.DoUploadToStencilTest(
    format,
    textureSize,
    copyMethod,
    bytesPerRow,
    rowsPerImage,
    initialDataSize,
    initialDataOffset,
    mipLevel);

  }
});
//# sourceMappingURL=image_copy.spec.js.map