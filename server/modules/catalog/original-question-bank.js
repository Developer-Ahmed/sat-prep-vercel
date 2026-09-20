const BANK_VERSION = "2026.09.1";

const DOMAIN_CODES = {
  "Algebra": "ALG",
  "Advanced Math": "ADV",
  "Problem-Solving and Data Analysis": "PSDA",
  "Geometry and Trigonometry": "GEO",
  "Craft and Structure": "CAS",
  "Information and Ideas": "INI",
  "Standard English Conventions": "SEC",
  "Expression of Ideas": "EOI"
};

const questions = [];
const domainCounters = new Map();

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function difficultyFor(index) {
  return ["E", "M", "M", "H"][index % 4];
}

function choiceSet(correct, distractors, offset = 0) {
  const correctText = String(correct);
  const values = [correctText, ...distractors.map(String)]
    .filter((value, index, all) => value.trim() && all.indexOf(value) === index)
    .slice(0, 4);
  if (values.length !== 4) throw new Error(`Question choices are not unique for answer ${correctText}.`);
  const correctIndex = Math.abs(Number(offset) || 0) % 4;
  const ordered = values.filter((value) => value !== correctText);
  ordered.splice(correctIndex, 0, correctText);
  const answerOptions = Object.fromEntries(ordered.map((value, index) => [
    String.fromCharCode(65 + index),
    escapeHtml(value)
  ]));
  return {
    answerOptions,
    correctAnswer: [String.fromCharCode(65 + correctIndex)]
  };
}

function addQuestion({
  subject,
  domain,
  skill,
  difficulty,
  stem,
  stimulus = "",
  answerOptions,
  correctAnswer,
  rationale
}) {
  const counterKey = `${subject}:${domain}`;
  const domainNumber = (domainCounters.get(counterKey) || 0) + 1;
  domainCounters.set(counterKey, domainNumber);
  const number = String(domainNumber).padStart(4, "0");
  const id = `P16-${subject === "math" ? "M" : "R"}-${DOMAIN_CODES[domain]}-${number}`;
  questions.push(Object.freeze({
    rowId: `${subject}:${id.toLowerCase()}`,
    source: "peak1600",
    sourceQuestionId: id,
    subject,
    program: "peak1600-original",
    domain: DOMAIN_CODES[domain],
    domainDesc: domain,
    skill: skill.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48),
    skillDesc: skill,
    difficulty,
    rawJson: {
      author: "PEAK1600",
      bankVersion: BANK_VERSION,
      independentlyAuthored: true
    },
    content: {
      answerOptions,
      correct_answer: correctAnswer,
      rationale: `<p>${rationale}</p>`,
      stem: `<p>${stem}</p>`,
      stimulus,
      type: answerOptions ? "multiple_choice" : "student_produced_response"
    }
  }));
}

function addNumericQuestion({ subject = "math", domain, skill, difficulty, stem, correct, distractors, rationale, index }) {
  if (index % 5 === 4) {
    addQuestion({
      subject,
      domain,
      skill,
      difficulty,
      stem,
      correctAnswer: [String(correct)],
      rationale
    });
    return;
  }
  const numericCorrect = Number(correct);
  const expandedDistractors = Number.isFinite(numericCorrect)
    ? [...distractors, numericCorrect + 2, numericCorrect - 2, numericCorrect + 3, numericCorrect - 3]
    : distractors;
  const choices = choiceSet(correct, expandedDistractors, index);
  addQuestion({
    subject,
    domain,
    skill,
    difficulty,
    stem,
    ...choices,
    rationale
  });
}

function buildMathQuestions() {
  for (let index = 0; index < 32; index += 1) {
    const coefficient = 2 + (index % 7);
    const solution = 3 + ((index * 3) % 17);
    const constant = (index % 9) - 4;
    const result = coefficient * solution + constant;
    addNumericQuestion({
      domain: "Algebra",
      skill: "Linear equations in one variable",
      difficulty: difficultyFor(index),
      stem: `What value of <em>x</em> satisfies ${coefficient}<em>x</em> ${constant < 0 ? "−" : "+"} ${Math.abs(constant)} = ${result}?`,
      correct: solution,
      distractors: [solution - 1, solution + 1, coefficient * solution],
      rationale: `${constant < 0 ? `Adding ${Math.abs(constant)}` : `Subtracting ${constant}`} on both sides and then dividing by ${coefficient} gives <em>x</em> = ${solution}.`,
      index
    });
  }

  for (let index = 0; index < 20; index += 1) {
    const x = 2 + (index % 9);
    const y = 3 + ((index * 2) % 11);
    const sum = x + y;
    const difference = 2 * x - y;
    addNumericQuestion({
      domain: "Algebra",
      skill: "Systems of two linear equations",
      difficulty: difficultyFor(index + 1),
      stem: `The system <br><strong><em>x</em> + <em>y</em> = ${sum}</strong><br><strong>2<em>x</em> − <em>y</em> = ${difference}</strong><br>has solution (<em>x</em>, <em>y</em>). What is the value of <em>x</em>?`,
      correct: x,
      distractors: [y, sum, x + 1],
      rationale: `Adding the equations gives 3<em>x</em> = ${3 * x}, so <em>x</em> = ${x}.`,
      index
    });
  }

  for (let index = 0; index < 18; index += 1) {
    const rate = 2 + (index % 8);
    const initial = 5 + ((index * 3) % 16);
    const input = 3 + (index % 7);
    const output = rate * input + initial;
    addNumericQuestion({
      domain: "Algebra",
      skill: "Linear functions",
      difficulty: difficultyFor(index + 2),
      stem: `A linear function is defined by <em>f</em>(<em>x</em>) = ${rate}<em>x</em> + ${initial}. What is <em>f</em>(${input})?`,
      correct: output,
      distractors: [output - rate, output + rate, rate + initial + input],
      rationale: `Substituting ${input} for <em>x</em> gives ${rate}(${input}) + ${initial} = ${output}.`,
      index
    });
  }

  for (let index = 0; index < 18; index += 1) {
    const unitCost = 3 + (index % 6);
    const fixedCost = 4 + (index % 9);
    const maximum = 5 + ((index * 2) % 13);
    const budget = unitCost * maximum + fixedCost;
    addNumericQuestion({
      domain: "Algebra",
      skill: "Linear inequalities",
      difficulty: difficultyFor(index + 3),
      stem: `A rental costs $${fixedCost} plus $${unitCost} per hour. If a customer can spend at most $${budget}, what is the greatest whole number of hours the customer can rent the item?`,
      correct: maximum,
      distractors: [maximum - 1, maximum + 1, maximum + fixedCost],
      rationale: `The inequality ${fixedCost} + ${unitCost}<em>h</em> ≤ ${budget} simplifies to <em>h</em> ≤ ${maximum}.`,
      index
    });
  }

  for (let index = 0; index < 28; index += 1) {
    const firstRoot = 1 + (index % 8);
    const secondRoot = firstRoot + 2 + (index % 5);
    const sum = firstRoot + secondRoot;
    const product = firstRoot * secondRoot;
    addNumericQuestion({
      domain: "Advanced Math",
      skill: "Quadratic equations",
      difficulty: difficultyFor(index + 1),
      stem: `What is the greater solution to <em>x</em><sup>2</sup> − ${sum}<em>x</em> + ${product} = 0?`,
      correct: secondRoot,
      distractors: [firstRoot, sum, product],
      rationale: `The expression factors as (<em>x</em> − ${firstRoot})(<em>x</em> − ${secondRoot}), so the greater solution is ${secondRoot}.`,
      index
    });
  }

  for (let index = 0; index < 22; index += 1) {
    const a = 1 + (index % 7);
    const b = 2 + ((index * 2) % 9);
    const middle = a + b;
    const constant = a * b;
    const correct = `x² + ${middle}x + ${constant}`;
    const choices = choiceSet(correct, [
      `x² + ${constant}x + ${middle}`,
      `x² + ${middle}x − ${constant}`,
      `2x² + ${middle}x + ${constant}`
    ], index);
    addQuestion({
      subject: "math",
      domain: "Advanced Math",
      skill: "Equivalent expressions",
      difficulty: difficultyFor(index + 2),
      stem: `Which expression is equivalent to (<em>x</em> + ${a})(<em>x</em> + ${b})?`,
      ...choices,
      rationale: `Multiplying gives <em>x</em><sup>2</sup> + ${b}<em>x</em> + ${a}<em>x</em> + ${constant}, which combines to <em>x</em><sup>2</sup> + ${middle}<em>x</em> + ${constant}.`
    });
  }

  for (let index = 0; index < 18; index += 1) {
    const initial = 3 + (index % 8);
    const periods = 2 + (index % 5);
    const output = initial * (2 ** periods);
    addNumericQuestion({
      domain: "Advanced Math",
      skill: "Exponential functions",
      difficulty: difficultyFor(index + 3),
      stem: `A culture begins with ${initial} cells and doubles every hour. How many cells are present after ${periods} hours?`,
      correct: output,
      distractors: [initial * 2 * periods, output / 2, output + initial],
      rationale: `After ${periods} doublings, the number is ${initial}(2<sup>${periods}</sup>) = ${output}.`,
      index
    });
  }

  for (let index = 0; index < 18; index += 1) {
    const h = (index % 9) - 4;
    const k = 2 + ((index * 3) % 17);
    addNumericQuestion({
      domain: "Advanced Math",
      skill: "Nonlinear functions",
      difficulty: difficultyFor(index),
      stem: `The function <em>g</em> is defined by <em>g</em>(<em>x</em>) = (<em>x</em> ${h < 0 ? "+" : "−"} ${Math.abs(h)})<sup>2</sup> + ${k}. What is the minimum value of <em>g</em>(<em>x</em>)?`,
      correct: k,
      distractors: [h, Math.abs(h), k + 1],
      rationale: `A square is never negative and equals 0 when <em>x</em> = ${h}. Therefore, the minimum value is ${k}.`,
      index
    });
  }

  for (let index = 0; index < 16; index += 1) {
    const percent = [10, 15, 20, 25][index % 4];
    const original = 40 + 20 * index;
    const increase = original * percent / 100;
    const result = original + increase;
    addNumericQuestion({
      domain: "Problem-Solving and Data Analysis",
      skill: "Percentages",
      difficulty: difficultyFor(index),
      stem: `A quantity of ${original} is increased by ${percent}%. What is the resulting quantity?`,
      correct: result,
      distractors: [increase, original - increase, original + percent],
      rationale: `${percent}% of ${original} is ${increase}; adding that increase gives ${result}.`,
      index
    });
  }

  for (let index = 0; index < 16; index += 1) {
    const hours = 2 + (index % 5);
    const rate = 24 + 3 * (index % 9);
    const distance = hours * rate;
    addNumericQuestion({
      domain: "Problem-Solving and Data Analysis",
      skill: "Rates and unit conversion",
      difficulty: difficultyFor(index + 1),
      stem: `A vehicle travels ${distance} miles in ${hours} hours at a constant speed. What is its speed, in miles per hour?`,
      correct: rate,
      distractors: [distance - hours, distance + hours, rate * hours],
      rationale: `Unit rate equals distance divided by time: ${distance} ÷ ${hours} = ${rate} miles per hour.`,
      index
    });
  }

  for (let index = 0; index < 12; index += 1) {
    const base = 4 + index;
    const values = [base, base + 2, base + 4, base + 6];
    const mean = base + 3;
    addNumericQuestion({
      domain: "Problem-Solving and Data Analysis",
      skill: "Measures of center",
      difficulty: difficultyFor(index + 2),
      stem: `What is the mean of ${values.join(", ")}?`,
      correct: mean,
      distractors: [base + 2, base + 4, base + 6],
      rationale: `The sum is ${mean * 4}; dividing by 4 gives a mean of ${mean}.`,
      index
    });
  }

  for (let index = 0; index < 10; index += 1) {
    const favorable = 2 + (index % 5);
    const total = favorable + 5 + Math.floor(index / 5);
    const correct = `${favorable}/${total}`;
    const choices = choiceSet(correct, [
      `${total - favorable}/${total}`,
      `${favorable}/${total + 1}`,
      `1/${total}`,
      `${favorable + 1}/${total}`
    ], index);
    addQuestion({
      subject: "math",
      domain: "Problem-Solving and Data Analysis",
      skill: "Probability",
      difficulty: difficultyFor(index + 3),
      stem: `A bag contains ${favorable} blue tokens and ${total - favorable} white tokens. One token is selected at random. What is the probability that it is blue?`,
      ...choices,
      rationale: `There are ${favorable} favorable outcomes among ${total} equally likely outcomes, so the probability is ${favorable}/${total}.`
    });
  }

  for (let index = 0; index < 14; index += 1) {
    const width = 3 + (index % 9);
    const length = width + 2 + (index % 5);
    const area = width * length;
    addNumericQuestion({
      domain: "Geometry and Trigonometry",
      skill: "Area and volume",
      difficulty: difficultyFor(index),
      stem: `A rectangle has width ${width} units and length ${length} units. What is its area, in square units?`,
      correct: area,
      distractors: [2 * (width + length), area + width, length - width],
      rationale: `The area of a rectangle is length times width: ${length}(${width}) = ${area}.`,
      index
    });
  }

  for (let index = 0; index < 14; index += 1) {
    const radius = 2 + index;
    const correct = `${2 * radius}π`;
    const choices = choiceSet(correct, [
      `${radius}π`,
      `${radius * radius}π`,
      `${2 * radius * radius}π`,
      `${2 * radius + 2}π`
    ], index);
    addQuestion({
      subject: "math",
      domain: "Geometry and Trigonometry",
      skill: "Circles",
      difficulty: difficultyFor(index + 1),
      stem: `A circle has radius ${radius}. What is its circumference?`,
      ...choices,
      rationale: `Circumference is 2π<em>r</em>. Substituting <em>r</em> = ${radius} gives ${2 * radius}π.`
    });
  }

  const triples = [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25]];
  for (let index = 0; index < 14; index += 1) {
    const scale = 1 + Math.floor(index / triples.length);
    const [a, b, c] = triples[index % triples.length].map((value) => value * scale);
    addNumericQuestion({
      domain: "Geometry and Trigonometry",
      skill: "Right triangles",
      difficulty: difficultyFor(index + 2),
      stem: `A right triangle has legs of lengths ${a} and ${b}. What is the length of its hypotenuse?`,
      correct: c,
      distractors: [a + b, c - 1, c + 1],
      rationale: `By the Pythagorean theorem, the hypotenuse is √(${a}<sup>2</sup> + ${b}<sup>2</sup>) = ${c}.`,
      index
    });
  }

  for (let index = 0; index < 14; index += 1) {
    const side = 2 + index;
    const volume = side ** 3;
    addNumericQuestion({
      domain: "Geometry and Trigonometry",
      skill: "Area and volume",
      difficulty: difficultyFor(index + 3),
      stem: `A cube has edge length ${side}. What is its volume?`,
      correct: volume,
      distractors: [side * side, 6 * side * side, 3 * side],
      rationale: `The volume of a cube is <em>s</em><sup>3</sup>, so the volume is ${side}<sup>3</sup> = ${volume}.`,
      index
    });
  }
}

const vocabularyQuestions = [
  ["Because the measurements varied only slightly, the engineer described the instrument as remarkably ____.", "consistent", ["erratic", "ornamental", "temporary"], "Consistent means remaining uniform or dependable."],
  ["The committee offered a ____ recommendation because several important costs were still unknown.", "tentative", ["definitive", "hostile", "irrelevant"], "Tentative means provisional or not yet certain."],
  ["Independent records helped ____ the witness's account of the event.", "corroborate", ["conceal", "contradict", "invent"], "To corroborate an account is to support it with additional evidence."],
  ["Planting shade trees can ____ the effect of extreme heat on city sidewalks.", "mitigate", ["intensify", "predict", "imitate"], "To mitigate an effect is to make it less severe."],
  ["The researcher proposed a ____ method that had not been tested in this field before.", "novel", ["routine", "obsolete", "careless"], "Novel means new or unusually original in this context."],
  ["The directions were ____ enough that two teams interpreted them differently.", "ambiguous", ["precise", "brief", "accurate"], "Ambiguous language allows more than one reasonable interpretation."],
  ["Rather than seek a perfect solution, the mayor adopted a ____ plan that could be implemented immediately.", "pragmatic", ["theoretical", "reckless", "ceremonial"], "Pragmatic means focused on practical results."],
  ["The editor asked for a ____ summary that retained only the report's essential findings.", "concise", ["lengthy", "speculative", "decorative"], "Concise writing expresses the necessary information in few words."],
  ["To evaluate the proposals fairly, the panel selected an ____ reviewer with no connection to either team.", "impartial", ["biased", "inexperienced", "enthusiastic"], "Impartial means fair and not favoring one side."],
  ["The bridge's ____ design allowed it to remain stable during unusually strong winds.", "robust", ["fragile", "ornate", "temporary"], "Robust means strong and able to withstand difficult conditions."],
  ["After reviewing the budget, the team concluded that the smaller project was financially ____.", "feasible", ["impossible", "accidental", "controversial"], "Feasible means possible and practical to accomplish."],
  ["The speaker used an unfamiliar abbreviation that ____ the meaning of an otherwise clear sentence.", "obscured", ["clarified", "confirmed", "summarized"], "Obscured means made difficult to understand."],
  ["The biologist was ____ in recording each observation, checking every label twice.", "meticulous", ["careless", "hurried", "indifferent"], "Meticulous means extremely careful and attentive to detail."],
  ["The new evidence forced historians to ____ a long-standing explanation of the migration.", "revise", ["preserve", "ignore", "celebrate"], "To revise an explanation is to change it in light of new information."],
  ["The two accounts appear to ____: one places the event in May, while the other places it in August.", "conflict", ["converge", "cooperate", "alternate"], "Accounts conflict when they are inconsistent with one another."],
  ["The artist's early sketches ____ the geometric patterns that became prominent in her later work.", "foreshadow", ["erase", "criticize", "duplicate"], "To foreshadow is to indicate a development before it fully appears."]
];

const readingPassages = [
  ["A neighborhood library tested later closing hours for one month. Evening visits rose sharply, while daytime visits stayed nearly unchanged. The library therefore kept the later schedule twice a week.", "Extending hours on selected days increased access without reducing daytime use."],
  ["Researchers placed identical seedlings under white, red, and blue lights. Seedlings under blue light developed the widest leaves, but those under white light grew tallest. The results show that growth depends on which feature is measured.", "Different light conditions favored different aspects of seedling growth."],
  ["A city replaced several downtown parking spaces with bicycle racks. Although some merchants predicted fewer customers, sales receipts in the area remained stable and bicycle traffic increased.", "The bicycle racks increased bicycle traffic without the predicted decline in local sales."],
  ["An archaeologist compared clay from ancient jars with clay deposits across a coastal region. Most jars matched deposits near the settlement, but a few matched a distant island, suggesting limited long-distance trade.", "Clay evidence indicates that most jars were local while some arrived through trade."],
  ["A software team shortened its weekly meeting and required written updates beforehand. The team completed more agenda items, and employees reported that the meeting felt more focused.", "Written preparation and a shorter meeting improved meeting efficiency."],
  ["Marine scientists recorded whale calls near a busy shipping lane before and after ships were asked to reduce speed. After the change, background noise declined and the calls could be detected from farther away.", "Slower ship traffic reduced noise that had limited detection of whale calls."],
  ["A museum displayed some artifacts with detailed labels and others with short labels plus an optional audio guide. Visitors spent similar total time in both areas, but more visitors recalled details from the audio-guide area.", "Optional audio explanations improved recall without increasing total visit time."],
  ["A farmer planted the same tomato variety in mulched and unmulched plots. The mulched plots retained more soil moisture and required less irrigation, while fruit production was similar in both groups.", "Mulch reduced irrigation needs without changing tomato production."],
  ["Students practiced a musical passage either in one long session or in three shorter sessions across a week. Both groups practiced for the same total time, but the distributed-practice group performed more accurately.", "Spreading practice across several days improved performance accuracy."],
  ["Engineers tested two window coatings during winter. Coating A admitted more daylight, whereas coating B reduced heat loss more effectively. The preferred coating therefore depends on a building's priorities.", "Each window coating offered a different benefit, so the best choice depends on the goal."],
  ["A historian examined household lists from a town over fifty years. The lists showed that multigenerational households became less common as factory employment expanded, though the records did not explain why.", "Household structure changed as factory employment grew, but the cause remains uncertain."],
  ["A transit agency added real-time arrival displays at half of its stops. Riders at those stops did not wait less time, but they rated the wait as less frustrating than riders without displays.", "Arrival information improved riders' experience even though actual waits were unchanged."],
  ["A botanist found that flowers visited by several bee species produced more seeds than flowers visited by only one species, even when the total number of visits was equal.", "A greater variety of bee visitors was associated with higher seed production."],
  ["A publisher released the same essay in print and audio formats. Readers and listeners answered factual questions equally well, but listeners completed the essay sooner.", "Audio delivery was faster while producing similar factual comprehension."],
  ["A lake-monitoring team measured water clarity after heavy rain. Clarity declined near river inlets but changed little in the lake's center, indicating that runoff effects were concentrated near incoming streams.", "The effect of runoff on water clarity was strongest near river inlets."],
  ["A school moved the start of an optional tutoring program from early morning to late afternoon. Attendance increased, but average test gains among attendees stayed about the same.", "Changing the schedule increased participation but not the average benefit for participants."]
];

const transitionQuestions = [
  ["The first prototype was inexpensive to manufacture. ____, it failed after only a few hours of use.", "However", ["Similarly", "Therefore", "For example"], "The second sentence contrasts low cost with poor durability."],
  ["The trail was closed after heavy rain. ____, hikers used the paved route around the lake.", "Consequently", ["Nevertheless", "Likewise", "Meanwhile"], "The alternate route was a result of the closure."],
  ["The survey included residents from every district. ____, its sample reflected the city's geographic diversity.", "Therefore", ["However", "Instead", "For instance"], "The representative sample follows from including every district."],
  ["Solar panels produce less electricity at night. ____, batteries can store excess daytime energy for later use.", "However", ["Therefore", "Similarly", "Specifically"], "The battery information qualifies the apparent limitation."],
  ["The first experiment measured temperature. ____, the second measured humidity.", "By contrast", ["As a result", "For example", "In addition"], "The transition highlights the different variables measured."],
  ["The archive contains thousands of letters. ____, it preserves maps, photographs, and newspaper clippings.", "In addition", ["Instead", "Consequently", "Nevertheless"], "The second sentence adds other materials to the list."],
  ["The material is lightweight. ____, it is strong enough to support the structure.", "Moreover", ["Otherwise", "Instead", "For example"], "The second sentence adds another favorable property."],
  ["The initial forecast predicted clear skies. ____, a storm arrived before noon.", "Nevertheless", ["Similarly", "Therefore", "For instance"], "The actual weather contrasts with the forecast."],
  ["The author interviewed several musicians. ____, she examined concert programs from the same period.", "Additionally", ["Conversely", "As a result", "Instead"], "The second research method supplements the first."],
  ["The medication reduced symptoms in the short trial. ____, longer studies are needed to assess lasting effects.", "Even so", ["For example", "Consequently", "Likewise"], "The need for more evidence limits the positive result."],
  ["The town restored the wetland. ____, native bird populations began to increase.", "Subsequently", ["In contrast", "For instance", "Meanwhile"], "The bird increase occurred after the restoration."],
  ["The two metals look similar. ____, one conducts heat much more efficiently than the other.", "Yet", ["Thus", "Likewise", "For example"], "Yet signals the contrast between similar appearance and different performance."]
];

function buildEnglishQuestions() {
  vocabularyQuestions.forEach(([sentence, correct, distractors, explanation], index) => {
    const choices = choiceSet(correct, distractors, index);
    addQuestion({
      subject: "english",
      domain: "Craft and Structure",
      skill: "Words in Context",
      difficulty: difficultyFor(index),
      stem: `${sentence}<br><br>Which choice completes the text with the most logical and precise word?`,
      ...choices,
      rationale: explanation
    });
  });

  readingPassages.forEach(([passage, mainIdea], index) => {
    const mainChoices = choiceSet(mainIdea, [
      "The project produced no measurable change and should be abandoned.",
      "The evidence proves that one approach is always best in every setting.",
      "The investigation focused mainly on explaining a historical disagreement."
    ], index);
    addQuestion({
      subject: "english",
      domain: "Information and Ideas",
      skill: "Central Ideas and Details",
      difficulty: difficultyFor(index + 1),
      stimulus: `<p>${passage}</p>`,
      stem: "Which choice best states the main idea of the text?",
      ...mainChoices,
      rationale: `The text's observations directly support this summary: ${mainIdea}`
    });

    const inference = `The author would most likely agree that the observed result should be interpreted in light of what the study actually measured.`;
    const inferenceChoices = choiceSet(inference, [
      "The study establishes a universal rule that applies without exceptions.",
      "The reported observations are irrelevant to the researchers' conclusion.",
      "The study's participants deliberately altered the final measurements."
    ], index + 1);
    addQuestion({
      subject: "english",
      domain: "Information and Ideas",
      skill: "Inferences",
      difficulty: difficultyFor(index + 2),
      stimulus: `<p>${passage}</p>`,
      stem: "Which conclusion is best supported by the text?",
      ...inferenceChoices,
      rationale: "The passage reports a bounded observation. The supported inference respects that evidence without turning it into an unsupported universal claim."
    });
  });

  readingPassages.forEach(([passage], index) => {
    const correct = "to present observations and explain the conclusion they support";
    const choices = choiceSet(correct, [
      "to narrate a fictional conflict and reveal its resolution",
      "to criticize researchers for withholding contradictory evidence",
      "to define a technical term without discussing any findings"
    ], index + 2);
    addQuestion({
      subject: "english",
      domain: "Craft and Structure",
      skill: "Text Structure and Purpose",
      difficulty: difficultyFor(index + 3),
      stimulus: `<p>${passage}</p>`,
      stem: "Which choice best describes the main purpose of the text?",
      ...choices,
      rationale: "The text introduces observations from an investigation and then states what those observations suggest."
    });
  });

  const singularSubjects = [
    ["The collection of field notes", "provides", "provide", "important information about the project"],
    ["The series of experiments", "reveals", "reveal", "a consistent pattern"],
    ["Each of the proposed routes", "passes", "pass", "near the river"],
    ["The pattern in the measurements", "suggests", "suggest", "that the instrument drifted"],
    ["A group of local volunteers", "organizes", "organize", "the annual cleanup"],
    ["The impact of the new rules", "remains", "remain", "uncertain"],
    ["Neither of the two explanations", "accounts", "account", "for the discrepancy"],
    ["The availability of fresh produce", "varies", "vary", "by season"],
    ["The design of the new shelters", "reflects", "reflect", "the region's climate"],
    ["One of the surviving journals", "describes", "describe", "the expedition in detail"],
    ["The location of the sample sites", "affects", "affect", "the amount of sunlight recorded"],
    ["The number of evening visitors", "has", "have", "increased since June"],
    ["Every box of archived photographs", "contains", "contain", "a handwritten inventory"],
    ["The quality of the recordings", "depends", "depend", "on microphone placement"],
    ["The oldest of the three buildings", "requires", "require", "extensive repairs"],
    ["The relationship between the variables", "appears", "appear", "linear"]
  ];
  singularSubjects.forEach(([subject, correct, wrong, complement], index) => {
    const choices = choiceSet(correct, [wrong, `to ${wrong}`, "being"], index);
    addQuestion({
      subject: "english",
      domain: "Standard English Conventions",
      skill: "Form, Structure, and Sense",
      difficulty: difficultyFor(index),
      stem: `${subject} ____ ${complement}.<br><br>Which choice completes the text so that it conforms to Standard English conventions?`,
      ...choices,
      rationale: `The grammatical subject is singular, so the singular verb “${correct}” is required.`
    });
  });

  const boundaryItems = [
    ["The rain stopped", "the match resumed ten minutes later"],
    ["The first sample was contaminated", "the researchers collected another"],
    ["The path crosses a steep ridge", "hikers should carry sufficient water"],
    ["The orchestra finished rehearsing", "the audience began entering the hall"],
    ["The new lens is smaller", "it captures more light than the earlier model"],
    ["The river flooded in spring", "nearby farms received deposits of rich soil"],
    ["The recipe uses only four ingredients", "careful timing is still essential"],
    ["The data were incomplete", "the team postponed its final conclusion"],
    ["The sculpture appears delicate", "its steel frame is extremely strong"],
    ["The store extended its hours", "evening sales increased"],
    ["The seedlings received equal amounts of water", "their growth rates differed"],
    ["The map was drawn centuries ago", "many of its coastal features remain recognizable"],
    ["The battery is inexpensive", "it can be recharged hundreds of times"],
    ["The lecture ended early", "students stayed to continue the discussion"],
    ["The soil looked dry", "moisture remained several centimeters below the surface"],
    ["The station added more trains", "average wait times declined"]
  ];
  boundaryItems.forEach(([first, second], index) => {
    const correct = `${first}; ${second}.`;
    const choices = choiceSet(correct, [
      `${first}, ${second}.`,
      `${first} ${second}.`,
      `${first}: and ${second}.`
    ], index + 1);
    addQuestion({
      subject: "english",
      domain: "Standard English Conventions",
      skill: "Boundaries",
      difficulty: difficultyFor(index + 1),
      stem: "Which choice completes the text so that it conforms to Standard English conventions?",
      ...choices,
      rationale: "The two complete sentences are correctly joined by a semicolon. A comma alone would create a comma splice."
    });
  });

  transitionQuestions.forEach(([sentence, correct, distractors, explanation], index) => {
    const choices = choiceSet(correct, distractors, index);
    addQuestion({
      subject: "english",
      domain: "Expression of Ideas",
      skill: "Transitions",
      difficulty: difficultyFor(index + 2),
      stem: `${sentence}<br><br>Which choice completes the text with the most logical transition?`,
      ...choices,
      rationale: explanation
    });
  });

  const noteTopics = [
    ["Architect Lina Bo", "designed a community center", "used locally sourced brick", "reduced transportation costs"],
    ["Biologist Omar Reyes", "studied desert beetles", "observed activity after sunset", "connected the behavior to cooler temperatures"],
    ["Historian Mei Carter", "examined ship logs", "found repeated stops at a small port", "showed the port's regional importance"],
    ["Engineer Priya Shah", "tested a water filter", "used layers of sand and charcoal", "removed most visible sediment"],
    ["Composer Daniel Okafor", "wrote a chamber piece", "combined strings with hand percussion", "created contrasting textures"],
    ["Ecologist Rosa Kim", "surveyed rooftop gardens", "recorded twelve bee species", "documented urban habitat value"],
    ["Economist Leo Martin", "analyzed bus fares", "compared five neighboring cities", "found lower fares associated with higher ridership"],
    ["Chemist Amara Singh", "developed a coating", "tested it in salt water", "slowed metal corrosion"],
    ["Linguist Noah Chen", "recorded regional speech", "interviewed speakers of different ages", "identified a changing vowel pattern"],
    ["Astronomer Sofia Patel", "tracked a variable star", "measured brightness for six months", "confirmed a regular cycle"],
    ["Artist Elena Brooks", "created a public mural", "invited residents to contribute designs", "incorporated neighborhood history"],
    ["Geologist Marcus Lee", "mapped an ancient lava flow", "used mineral composition to compare sites", "linked distant rock formations"]
  ];
  noteTopics.forEach(([person, action, method, finding], index) => {
    const correct = `${person} ${action}, ${method}, and the project ${finding}.`;
    const choices = choiceSet(correct, [
      `${person} completed a project, but no details about its method or result are known.`,
      `${finding}, even though ${person} did not conduct the work described.`,
      `${method}; unrelated researchers later rejected every observation.`
    ], index + 3);
    addQuestion({
      subject: "english",
      domain: "Expression of Ideas",
      skill: "Rhetorical Synthesis",
      difficulty: difficultyFor(index + 3),
      stimulus: `<p>A student has taken the following notes:</p><ul><li>${person} ${action}.</li><li>${person} ${method}.</li><li>The work ${finding}.</li></ul>`,
      stem: "The student wants to summarize the project and its result. Which choice most effectively uses relevant information from the notes?",
      ...choices,
      rationale: "The correct choice accurately combines the project's subject, method, and result without adding unsupported information."
    });
  });
}

buildMathQuestions();
buildEnglishQuestions();

export const ORIGINAL_QUESTION_BANK_VERSION = BANK_VERSION;
export const ORIGINAL_QUESTION_BANK = Object.freeze(questions);
