import { FP } from '../../../../../util/floating_point.js';
import { makeCaseCache } from '../../case_cache.js';

// Cases: [f32|f16]_[non_]const
const cases = (['f32', 'f16', 'abstract'] as const)
  .flatMap(trait =>
    ([true, false] as const).map(nonConst => ({
      [`${trait}_${nonConst ? 'non_const' : 'const'}`]: () => {
        if (trait === 'abstract' && nonConst) {
          return [];
        }
        return FP[trait].generateScalarToIntervalCases(
          FP[trait].scalarRange(),
          nonConst ? 'unfiltered' : 'finite',
          // sqrt has an inherited accuracy, so is only expected to be as accurate as f32
          FP[trait !== 'abstract' ? trait : 'f32'].sqrtInterval
        );
      },
    }))
  )
  .reduce((a, b) => ({ ...a, ...b }), {});

export const d = makeCaseCache('sqrt', cases);
