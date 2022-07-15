/**
* AUTO-GENERATED - DO NOT EDIT. Source: https://github.com/gpuweb/cts
**/export const description = `
Execution tests for the 'max' builtin function

S is AbstractInt, i32, or u32
T is S or vecN<S>
@const fn max(e1: T ,e2: T) -> T
Returns e2 if e1 is less than e2, and e1 otherwise. Component-wise when T is a vector.

S is AbstractFloat, f32, f16
T is vecN<S>
@const fn max(e1: T ,e2: T) -> T
Returns e2 if e1 is less than e2, and e1 otherwise.
If one operand is a NaN, the other is returned.
If both operands are NaNs, a NaN is returned.
Component-wise when T is a vector.

`;import { makeTestGroup } from '../../../../../../common/framework/test_group.js';
import { GPUTest } from '../../../../../gpu_test.js';
import { correctlyRoundedMatch } from '../../../../../util/compare.js';
import { kValue } from '../../../../../util/constants.js';
import { i32, TypeF32, TypeI32, TypeU32, u32 } from '../../../../../util/conversion.js';
import { maxInterval } from '../../../../../util/f32_interval.js';
import { fullF32Range } from '../../../../../util/math.js';
import { allInputSources, makeBinaryF32IntervalCase, run } from '../../expression.js';

import { builtin } from './builtin.js';

/** Generate set of max test cases from list of interesting values */
function generateTestCases(
values,
makeCase)
{
  const cases = new Array();
  values.forEach((e) => {
    values.forEach((f) => {
      cases.push(makeCase(e, f));
    });
  });
  return cases;
}

export const g = makeTestGroup(GPUTest);

g.test('abstract_int').
specURL('https://www.w3.org/TR/WGSL/#integer-builtin-functions').
desc(`abstract int tests`).
params((u) =>
u.combine('inputSource', allInputSources).combine('vectorize', [undefined, 2, 3, 4])).

unimplemented();

g.test('u32').
specURL('https://www.w3.org/TR/WGSL/#integer-builtin-functions').
desc(`u32 tests`).
params((u) =>
u.combine('inputSource', allInputSources).combine('vectorize', [undefined, 2, 3, 4])).

fn(async (t) => {
  const cfg = t.params;
  cfg.cmpFloats = correctlyRoundedMatch();

  const makeCase = (x, y) => {
    return { input: [u32(x), u32(y)], expected: u32(Math.max(x, y)) };
  };

  const test_values = [0, 1, 2, 0x70000000, 0x80000000, 0xffffffff];
  const cases = generateTestCases(test_values, makeCase);

  run(t, builtin('max'), [TypeU32, TypeU32], TypeU32, cfg, cases);
});

g.test('i32').
specURL('https://www.w3.org/TR/WGSL/#integer-builtin-functions').
desc(`i32 tests`).
params((u) =>
u.combine('inputSource', allInputSources).combine('vectorize', [undefined, 2, 3, 4])).

fn(async (t) => {
  const cfg = t.params;
  cfg.cmpFloats = correctlyRoundedMatch();

  const makeCase = (x, y) => {
    return { input: [i32(x), i32(y)], expected: i32(Math.max(x, y)) };
  };

  const test_values = [-0x70000000, -2, -1, 0, 1, 2, 0x70000000];
  const cases = generateTestCases(test_values, makeCase);

  run(t, builtin('max'), [TypeI32, TypeI32], TypeI32, cfg, cases);
});

g.test('abstract_float').
specURL('https://www.w3.org/TR/WGSL/#float-builtin-functions').
desc(`abstract float tests`).
params((u) =>
u.combine('inputSource', allInputSources).combine('vectorize', [undefined, 2, 3, 4])).

unimplemented();

g.test('f32').
specURL('https://www.w3.org/TR/WGSL/#float-builtin-functions').
desc(`f32 tests`).
params((u) =>
u.combine('inputSource', allInputSources).combine('vectorize', [undefined, 2, 3, 4])).

fn(async (t) => {
  const makeCase = (x, y) => {
    return makeBinaryF32IntervalCase(x, y, maxInterval);
  };

  const cases = [];
  const numeric_range = fullF32Range();
  numeric_range.push(kValue.f32.infinity.positive, kValue.f32.infinity.negative);
  numeric_range.forEach((lhs) => {
    numeric_range.forEach((rhs) => {
      cases.push(makeCase(lhs, rhs));
    });
  });

  run(t, builtin('max'), [TypeF32, TypeF32], TypeF32, t.params, cases);
});

g.test('f16').
specURL('https://www.w3.org/TR/WGSL/#float-builtin-functions').
desc(`f16 tests`).
params((u) =>
u.combine('inputSource', allInputSources).combine('vectorize', [undefined, 2, 3, 4])).

unimplemented();
//# sourceMappingURL=max.spec.js.map