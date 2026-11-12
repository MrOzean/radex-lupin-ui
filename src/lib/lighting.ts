export interface LightingProfile {
  id: string;
  group: "Жилые помещения" | "Офисы и образование" | "Производство и склады";
  label: string;
  minimumLux: number;
  greenMaximumLux: number;
  flickerLimitPercent: number;
}

export const DEFAULT_LIGHTING_PROFILE_ID = "general";

export const GENERAL_LIGHTING_PROFILE: LightingProfile = {
  id: DEFAULT_LIGHTING_PROFILE_ID,
  group: "Офисы и образование",
  label: "Общая шкала",
  minimumLux: 300,
  greenMaximumLux: 2000,
  flickerLimitPercent: 10,
};

/** Approximate UI guides based on the norms listed by the user, not a compliance certificate. */
export const LIGHTING_PROFILES: readonly LightingProfile[] = [
  { id: "living-room", group: "Жилые помещения", label: "Жилая комната, спальня", minimumLux: 150, greenMaximumLux: 2000, flickerLimitPercent: 10 },
  { id: "kitchen", group: "Жилые помещения", label: "Кухня", minimumLux: 150, greenMaximumLux: 2000, flickerLimitPercent: 10 },
  { id: "kitchen-work", group: "Жилые помещения", label: "Кухня · рабочая зона", minimumLux: 300, greenMaximumLux: 2000, flickerLimitPercent: 10 },
  { id: "children-room", group: "Жилые помещения", label: "Детская", minimumLux: 200, greenMaximumLux: 2000, flickerLimitPercent: 5 },
  { id: "bathroom", group: "Жилые помещения", label: "Ванная, санузел", minimumLux: 50, greenMaximumLux: 2000, flickerLimitPercent: 20 },
  { id: "corridor", group: "Жилые помещения", label: "Коридор, прихожая", minimumLux: 50, greenMaximumLux: 2000, flickerLimitPercent: 20 },
  { id: "storage", group: "Жилые помещения", label: "Кладовая, гардероб", minimumLux: 50, greenMaximumLux: 2000, flickerLimitPercent: 20 },
  { id: "office", group: "Офисы и образование", label: "Кабинет, рабочая комната", minimumLux: 300, greenMaximumLux: 2000, flickerLimitPercent: 5 },
  { id: "computer-work", group: "Офисы и образование", label: "Постоянная работа за ПК", minimumLux: 400, greenMaximumLux: 2000, flickerLimitPercent: 5 },
  { id: "design-office", group: "Офисы и образование", label: "Проектное или чертёжное бюро", minimumLux: 500, greenMaximumLux: 2000, flickerLimitPercent: 10 },
  { id: "conference", group: "Офисы и образование", label: "Переговорная, конференц-зал", minimumLux: 200, greenMaximumLux: 2000, flickerLimitPercent: 10 },
  { id: "library", group: "Офисы и образование", label: "Читальный зал", minimumLux: 300, greenMaximumLux: 2000, flickerLimitPercent: 10 },
  { id: "classroom", group: "Офисы и образование", label: "Класс, аудитория", minimumLux: 300, greenMaximumLux: 2000, flickerLimitPercent: 10 },
  { id: "precision-work", group: "Производство и склады", label: "Работы наивысшей точности", minimumLux: 2000, greenMaximumLux: 5000, flickerLimitPercent: 10 },
  { id: "high-accuracy", group: "Производство и склады", label: "Работы высокой точности", minimumLux: 750, greenMaximumLux: 2000, flickerLimitPercent: 15 },
  { id: "medium-accuracy", group: "Производство и склады", label: "Работы средней точности", minimumLux: 400, greenMaximumLux: 2000, flickerLimitPercent: 20 },
  { id: "industrial-general", group: "Производство и склады", label: "Общие производственные зоны", minimumLux: 200, greenMaximumLux: 2000, flickerLimitPercent: 20 },
  { id: "warehouse", group: "Производство и склады", label: "Склад · периодическое присутствие", minimumLux: 50, greenMaximumLux: 2000, flickerLimitPercent: 20 },
] as const;

export function lightingProfileById(id: string): LightingProfile {
  if (id === DEFAULT_LIGHTING_PROFILE_ID) return GENERAL_LIGHTING_PROFILE;
  return LIGHTING_PROFILES.find((profile) => profile.id === id) ?? GENERAL_LIGHTING_PROFILE;
}

export function assessIlluminance(value: number, profile: LightingProfile): { tone: "good" | "warning"; text: string } {
  if (value < profile.minimumLux) {
    return { tone: "warning", text: `Ниже ориентира · ${profile.minimumLux} лк` };
  }
  if (value > profile.greenMaximumLux) {
    return { tone: "warning", text: `Выше ${profile.greenMaximumLux} лк` };
  }
  return { tone: "good", text: `Ориентир выполнен · от ${profile.minimumLux} лк` };
}

export function assessFlicker(value: number, profile: LightingProfile): { tone: "good" | "warning" | "danger"; text: string } {
  const limit = profile.flickerLimitPercent;
  if (value > limit) return { tone: "danger", text: `Выше ориентира · более ${limit}%` };
  if (value > limit * 0.8) return { tone: "warning", text: `Близко к пределу · до ${limit}%` };
  return { tone: "good", text: `В пределах ориентира · до ${limit}%` };
}
