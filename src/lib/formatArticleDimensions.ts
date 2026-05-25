type ArticleDimensions = {
  width_mm: number;
  height_mm: number;
  depth_mm?: number | null;
};

export function formatArticleDimensions(article: ArticleDimensions) {
  const parts = [`Širina ${article.width_mm} mm`, `Visina ${article.height_mm} mm`];
  if (article.depth_mm != null) {
    parts.push(`Dubina ${article.depth_mm} mm`);
  }
  return parts.join(' · ');
}

export function formatArticleDimensionsCompact(article: ArticleDimensions) {
  const parts = [`Š ${article.width_mm}`, `V ${article.height_mm}`];
  if (article.depth_mm != null) {
    parts.push(`D ${article.depth_mm}`);
  }
  return `${parts.join(' · ')} mm`;
}
