export const CELL_FORM_FOLDER = 'Cell form mockup';

export const CELL_FORM_CONTROL = {
  cellForm: {
    value: 'organism',
    options: {
      'consensus memory': 'organism',
      'legacy crystal': 'crystal',
    },
    label: 'A / B form',
  },
} as const;

export type CellForm = 'organism' | 'crystal';
