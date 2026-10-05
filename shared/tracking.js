export const stages = [['outWarehouse', 'Out warehouse'], ['inLocation', 'In location'], ['outLocation', 'Out location'], ['inWarehouse', 'In warehouse']];
export const defaultColumns = Object.fromEntries(stages.map(([key]) => [key, true]));
