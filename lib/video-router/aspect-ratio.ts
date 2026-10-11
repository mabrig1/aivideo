export type MasterAspectRatio =
  | '16:9'
  | '9:16'
  | '1:1'
  | '4:5'
  | '2.39:1';

export type GenerationAspectRatio = '16:9' | '9:16' | '1:1';

export type AspectRatioPlan = {
  requestedAspectRatio: MasterAspectRatio;
  generationAspectRatio: GenerationAspectRatio;
  requiresFinishing: boolean;
  finishingStrategy: string;
};

export function planAspectRatio(value: string): AspectRatioPlan {
  switch (value) {
    case '9:16':
      return {
        requestedAspectRatio: '9:16',
        generationAspectRatio: '9:16',
        requiresFinishing: false,
        finishingStrategy: 'Generate and master natively at 9:16.',
      };
    case '1:1':
      return {
        requestedAspectRatio: '1:1',
        generationAspectRatio: '1:1',
        requiresFinishing: false,
        finishingStrategy: 'Generate and master natively at 1:1.',
      };
    case '4:5':
      return {
        requestedAspectRatio: '4:5',
        generationAspectRatio: '9:16',
        requiresFinishing: true,
        finishingStrategy:
          'Generate a 9:16 center-safe frame, then crop/reframe to 4:5 during finishing after continuity and lip-sync QC.',
      };
    case '2.39:1':
      return {
        requestedAspectRatio: '2.39:1',
        generationAspectRatio: '16:9',
        requiresFinishing: true,
        finishingStrategy:
          'Generate a 16:9 center-safe frame, then crop/reframe to 2.39:1 during finishing after continuity and lip-sync QC.',
      };
    case '16:9':
    default:
      return {
        requestedAspectRatio: '16:9',
        generationAspectRatio: '16:9',
        requiresFinishing: false,
        finishingStrategy: 'Generate and master natively at 16:9.',
      };
  }
}
