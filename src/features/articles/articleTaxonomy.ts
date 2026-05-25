export type ArticleGroupOption = {
  value: string;
  label: string;
};

export type ArticleSubgroupOption = {
  value: string;
  label: string;
};

export const ARTICLE_GROUPS: ArticleGroupOption[] = [
  { value: 'Alkohol', label: 'Alkohol' },
  { value: 'Non-alkohol', label: 'Bez alkohola' },
  { value: 'Snacks', label: 'Grickalice' },
  { value: 'Dairy', label: 'Mlečni proizvodi' },
  { value: 'Household', label: 'Domaćinstvo' },
];

export const ARTICLE_SUBGROUPS: Record<string, ArticleSubgroupOption[]> = {
  Alkohol: [
    { value: 'Beer', label: 'Pivo' },
    { value: 'Wine', label: 'Vino' },
    { value: 'Spirits', label: 'Žestoka pića' },
    { value: 'Cider', label: 'Cider' },
  ],
  'Non-alkohol': [
    { value: 'Soft drinks', label: 'Gazirani napitci' },
    { value: 'Juices', label: 'Sokovi' },
    { value: 'Water', label: 'Voda' },
    { value: 'Energy drinks', label: 'Energetska pića' },
  ],
  Snacks: [
    { value: 'Chips', label: 'Čips' },
    { value: 'Chocolate', label: 'Čokolada' },
    { value: 'Candy', label: 'Bomboni' },
    { value: 'Nuts', label: 'Orašasti plodovi' },
  ],
  Dairy: [
    { value: 'Milk', label: 'Mleko' },
    { value: 'Yogurt', label: 'Jogurt' },
    { value: 'Cheese', label: 'Sir' },
    { value: 'Butter', label: 'Puter' },
  ],
  Household: [
    { value: 'Cleaning', label: 'Sredstva za čišćenje' },
    { value: 'Paper', label: 'Papirni proizvodi' },
    { value: 'Laundry', label: 'Veš i pranje' },
    { value: 'Other', label: 'Ostalo' },
  ],
};
