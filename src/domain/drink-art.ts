/** First-party illustrated product identifiers; never misrepresented as photos. */
const catalogueNames = [
  "33",
  "4th Street",
  "Amstel",
  "Amstel Can",
  "Big Ice",
  "Big Stout",
  "Budweiser",
  "Castle Lite",
  "Chamdor",
  "Desperados",
  "Desperados Can",
  "Fayrouz",
  "Fayrouz Can",
  "Flying Fish",
  "Goldberg",
  "Goldberg Black",
  "Goldberg Can",
  "Guinness Smooth",
  "Gulder",
  "Heineken",
  "Heineken Can",
  "Ice Black",
  "Legend",
  "Life",
  "Malta",
  "Malta Can",
  "Maltina",
  "Maltina Can",
  "Maltina PET 25cl",
  "Maltina PET 33cl",
  "Maltina PET 50cl",
  "Medium Heineken",
  "Medium Legend",
  "Medium Stout",
  "Origin",
  "Radler",
  "Small Ice",
  "Small Stout",
  "Small Turbo",
  "Star",
  "Stout Can",
  "Tiger",
  "Trophy",
  "Trophy Stout",
  "Turbo"
] as const;
const catalogue = new Set<string>(catalogueNames);

const shopAliases: Record<string,string> = {
  '"33" Export': "33",
  "33 Export": "33",
  "Big Guinness Stout": "Big Stout",
  "Small Guiness Stout": "Small Stout",
  "Small Guinness Stout": "Small Stout",
  "Medium Guinness Stout": "Medium Stout",
  "Big Smirnoff Ice": "Big Ice",
  "Small Smirnoff Ice": "Small Ice",
  "Amstel Malta": "Amstel",
  "Malta Guiness": "Malta",
  "Malta Guinness": "Malta",
  "Star Radler": "Radler",
  "Turbo King": "Turbo",
};

export function drinkArtworkPath(name: string): string {
  const canonical = catalogue.has(name) ? name : shopAliases[name];
  if (!canonical || !catalogue.has(canonical)) return "/drink-art/generic.svg";
  // Only allowlisted names determine local paths, never arbitrary user input.
  const slug = canonical.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `/drink-art/${slug}.svg`;
}

export const drinkArtworkCount = catalogueNames.length;
