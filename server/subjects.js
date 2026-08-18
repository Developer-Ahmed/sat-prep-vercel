export const SUBJECTS = {
  math: {
    key: "math",
    label: "SAT Math",
    shortLabel: "Math",
    title: "SAT Math Practice",
    rowLabel: "SAT Math Rows",
    route: "/",
    test: 2,
    domains: "H,P,Q,S",
    liveItemsKey: "mathLiveItems",
    defaultCount: 22,
    defaultMinutes: 35,
    supportsRealistic: true,
    supportsSection: true,
    referenceSheet: true
  },
  english: {
    key: "english",
    label: "SAT Reading & Writing",
    shortLabel: "English",
    title: "SAT Reading & Writing Practice",
    rowLabel: "SAT Reading & Writing Rows",
    route: "/english",
    test: 1,
    domains: "INI,CAS,EOI,SEC",
    liveItemsKey: "readingLiveItems",
    defaultCount: 27,
    defaultMinutes: 32,
    supportsRealistic: true,
    supportsSection: true,
    referenceSheet: false
  }
};

export function normalizeSubject(value) {
  return value === "english" ? "english" : "math";
}

export function subjectConfig(value) {
  return SUBJECTS[normalizeSubject(value)];
}
