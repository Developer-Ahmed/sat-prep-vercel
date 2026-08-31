import { normalizeSubject } from "../../subjects.js";
import { shuffled } from "../../shared/random.js";

const QUOTAS = {
  math: [
    { "Algebra": 8, "Advanced Math": 8, "Problem-Solving and Data Analysis": 3, "Geometry and Trigonometry": 3 },
    { "Algebra": 8, "Advanced Math": 7, "Problem-Solving and Data Analysis": 4, "Geometry and Trigonometry": 3 },
    { "Algebra": 8, "Advanced Math": 7, "Problem-Solving and Data Analysis": 3, "Geometry and Trigonometry": 4 },
    { "Algebra": 7, "Advanced Math": 8, "Problem-Solving and Data Analysis": 4, "Geometry and Trigonometry": 3 },
    { "Algebra": 7, "Advanced Math": 8, "Problem-Solving and Data Analysis": 3, "Geometry and Trigonometry": 4 },
    { "Algebra": 7, "Advanced Math": 7, "Problem-Solving and Data Analysis": 4, "Geometry and Trigonometry": 4 }
  ],
  english: [
    { "Information and Ideas": 7, "Expression of Ideas": 5, "Craft and Structure": 8, "Standard English Conventions": 7 },
    { "Information and Ideas": 7, "Expression of Ideas": 6, "Craft and Structure": 7, "Standard English Conventions": 7 },
    { "Information and Ideas": 6, "Expression of Ideas": 5, "Craft and Structure": 8, "Standard English Conventions": 8 },
    { "Information and Ideas": 7, "Expression of Ideas": 4, "Craft and Structure": 8, "Standard English Conventions": 8 },
    { "Information and Ideas": 6, "Expression of Ideas": 6, "Craft and Structure": 8, "Standard English Conventions": 7 },
    { "Information and Ideas": 7, "Expression of Ideas": 5, "Craft and Structure": 7, "Standard English Conventions": 8 }
  ]
};

export function realisticQuotaOptions(subject = "math") {
  return QUOTAS[normalizeSubject(subject)].map((quota) => ({ ...quota }));
}

export function chooseFillableQuota(counts, subject = "math", random = Math.random) {
  const options = realisticQuotaOptions(subject);
  const fillable = options.filter((quota) =>
    Object.entries(quota).every(([domain, needed]) => Number(counts?.[domain] || 0) >= needed)
  );
  if (!fillable.length) return null;
  return fillable[Math.floor(random() * fillable.length) % fillable.length];
}

function englishOrder(row) {
  const domain = String(row.domain_desc || "").trim();
  const skill = String(row.skill_desc || "").trim();
  if (domain === "Craft and Structure") return 0;
  if (domain === "Information and Ideas") return 1;
  if (domain === "Standard English Conventions") return 2;
  if (domain === "Expression of Ideas" && skill === "Transitions") return 3;
  if (domain === "Expression of Ideas" && skill === "Rhetorical Synthesis") return 4;
  if (domain === "Expression of Ideas") return 3;
  return 5;
}

export function orderRealisticRows(rows, subject = "math", random = Math.random) {
  if (normalizeSubject(subject) !== "english") return shuffled(rows, random);
  return rows
    .map((row) => ({ row, tie: random() }))
    .sort((a, b) => englishOrder(a.row) - englishOrder(b.row) || a.tie - b.tie)
    .map(({ row }) => row);
}
