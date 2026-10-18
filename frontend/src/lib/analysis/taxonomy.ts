/**
 * Skill taxonomy for requirement matching (PRD §4.3).
 *
 * Two different relations live here, and they are not interchangeable:
 *
 * - `related` is deliberately *not* equivalence: JavaScript is not TypeScript,
 *   React is not Angular, Docker is not Kubernetes, ML is not DL and
 *   C ≠ C++ ≠ C#. A related skill can never produce a **matched** requirement;
 *   it can only make an unsupported one "not evidenced yet" — enforced in
 *   `matching.ts` and locked down by `analysis.test.ts`.
 * - `implements` *is* equivalence, in one direction only. Some entries name a
 *   general capability ("SQL") that other entries are concrete forms of
 *   ("PostgreSQL is a SQL engine"). Evidence of the concrete form therefore
 *   satisfies the general requirement. The reverse never holds: an "MySQL"
 *   requirement with only "SQL" evidence stays unsupported, because knowing SQL
 *   does not tell us which engine you have used.
 *
 * `family` is a coarse neighbourhood ("frontend", "cloud", "language"…) used
 * only to decide whether an unsupported requirement is *not evidenced yet*
 * (you work in the area, it may be undocumented) or *genuinely missing*.
 */

export interface SkillEntry {
  /** Stable key; also used to build deterministic requirement ids. */
  key: string;
  /** Canonical display label. */
  label: string;
  /** Alternative spellings that mean the same thing. */
  aliases: string[];
  /** Adjacent skills — related, never equivalent (PRD §4.3). */
  related: string[];
  /** Keys of the general skills this entry is a concrete form of. */
  implements?: string[];
  family: string;
  /** True for single letters/very short terms needing exact-token matches. */
  short?: boolean;
}

export const SKILL_TAXONOMY: SkillEntry[] = [
  // Languages
  { key: "typescript", label: "TypeScript", aliases: ["ts", "type script"], related: ["javascript"], family: "language" },
  { key: "javascript", label: "JavaScript", aliases: ["js", "ecmascript", "es6"], related: ["typescript"], family: "language" },
  { key: "python", label: "Python", aliases: ["py"], related: [], family: "language" },
  { key: "java", label: "Java", aliases: [], related: ["kotlin"], family: "language" },
  { key: "kotlin", label: "Kotlin", aliases: [], related: ["java"], family: "language" },
  { key: "csharp", label: "C#", aliases: ["c sharp", "csharp"], related: ["dotnet"], family: "language" },
  { key: "dotnet", label: ".NET", aliases: ["dotnet", "asp.net", ".net core"], related: ["csharp"], family: "framework" },
  { key: "cpp", label: "C++", aliases: ["c plus plus", "cpp"], related: ["c"], family: "language" },
  { key: "c", label: "C", aliases: [], related: ["cpp"], family: "language", short: true },
  { key: "go", label: "Go", aliases: ["golang"], related: [], family: "language", short: true },
  { key: "rust", label: "Rust", aliases: [], related: [], family: "language" },
  { key: "php", label: "PHP", aliases: [], related: [], family: "language" },
  { key: "ruby", label: "Ruby", aliases: [], related: [], family: "language" },
  { key: "swift", label: "Swift", aliases: [], related: ["objective-c"], family: "language" },
  { key: "sql", label: "SQL", aliases: ["sql queries", "sql query"], related: ["postgresql", "mysql", "sqlite"], family: "database" },
  { key: "r", label: "R", aliases: [], related: [], family: "language", short: true },

  // Frontend
  { key: "react", label: "React", aliases: ["react.js", "reactjs"], related: ["vue", "angular"], family: "frontend" },
  { key: "vue", label: "Vue", aliases: ["vue.js", "vuejs"], related: ["react", "angular"], family: "frontend" },
  { key: "angular", label: "Angular", aliases: ["angularjs"], related: ["react", "vue"], family: "frontend" },
  { key: "nextjs", label: "Next.js", aliases: ["next.js", "nextjs", "next js"], related: ["react"], family: "frontend" },
  { key: "html", label: "HTML", aliases: ["html5"], related: ["css"], family: "frontend" },
  { key: "css", label: "CSS", aliases: ["css3"], related: ["html", "tailwindcss"], family: "frontend" },
  { key: "tailwindcss", label: "Tailwind CSS", aliases: ["tailwind", "tailwindcss", "tailwind ui"], related: ["css"], family: "frontend" },
  { key: "accessibility", label: "Accessibility", aliases: ["a11y", "wcag", "accessible"], related: ["html"], family: "frontend" },
  { key: "figma", label: "Figma", aliases: [], related: [], family: "design" },
  { key: "threejs", label: "Three.js", aliases: ["three.js", "threejs", "r3f"], related: ["webgl"], family: "frontend" },
  { key: "webgl", label: "WebGL", aliases: [], related: ["threejs"], family: "frontend" },

  // Backend / platform
  { key: "nodejs", label: "Node.js", aliases: ["node.js", "nodejs", "node js"], related: ["javascript"], family: "backend" },
  { key: "fastapi", label: "FastAPI", aliases: [], related: ["python"], family: "backend" },
  { key: "django", label: "Django", aliases: [], related: ["python"], family: "backend" },
  { key: "flask", label: "Flask", aliases: [], related: ["python"], family: "backend" },
  { key: "spring", label: "Spring", aliases: ["spring boot"], related: ["java"], family: "backend" },
  { key: "graphql", label: "GraphQL", aliases: [], related: ["rest"], family: "backend" },
  { key: "rest", label: "REST APIs", aliases: ["rest api", "restful", "rest apis", "rest"], related: ["graphql"], family: "backend" },
  { key: "grpc", label: "gRPC", aliases: [], related: ["rest"], family: "backend" },
  { key: "postgresql", label: "PostgreSQL", aliases: ["postgres", "postgresql", "pg"], related: ["sql", "mysql", "sqlite"], implements: ["sql"], family: "database" },
  { key: "mysql", label: "MySQL", aliases: ["mariadb"], related: ["sql", "postgresql"], implements: ["sql"], family: "database" },
  { key: "sqlite", label: "SQLite", aliases: [], related: ["sql", "postgresql"], implements: ["sql"], family: "database" },
  { key: "mongodb", label: "MongoDB", aliases: ["mongo", "mongodb"], related: [], family: "database" },
  { key: "redis", label: "Redis", aliases: [], related: [], family: "database" },
  { key: "kafka", label: "Kafka", aliases: ["apache kafka"], related: [], family: "infrastructure" },
  { key: "docker", label: "Docker", aliases: [], related: ["kubernetes"], family: "infrastructure" },
  { key: "kubernetes", label: "Kubernetes", aliases: ["k8s", "kube"], related: ["docker"], family: "infrastructure" },
  { key: "terraform", label: "Terraform", aliases: [], related: [], family: "infrastructure" },
  { key: "aws", label: "AWS", aliases: ["amazon web services", "amazon aws"], related: ["gcp", "azure"], family: "cloud" },
  { key: "gcp", label: "Google Cloud", aliases: ["gcp", "google cloud platform"], related: ["aws", "azure"], family: "cloud" },
  { key: "azure", label: "Azure", aliases: ["microsoft azure"], related: ["aws", "gcp"], family: "cloud" },
  { key: "linux", label: "Linux", aliases: ["unix"], related: [], family: "infrastructure" },
  { key: "git", label: "Git", aliases: [], related: ["github"], family: "tooling" },
  { key: "github", label: "GitHub", aliases: ["github actions", "gh actions"], related: ["git"], family: "tooling" },
  { key: "cicd", label: "CI/CD", aliases: ["ci cd", "ci/cd", "continuous integration", "continuous delivery", "continuous deployment"], related: ["github"], family: "tooling" },
  { key: "testing", label: "Automated testing", aliases: ["unit testing", "test automation", "integration tests", "integration testing", "automated tests"], related: [], family: "quality" },
  { key: "playwright", label: "Playwright", aliases: [], related: [], family: "quality" },
  { key: "cypress", label: "Cypress", aliases: [], related: ["playwright"], family: "quality" },
  { key: "jest", label: "Jest", aliases: [], related: ["vitest"], family: "quality" },
  { key: "vitest", label: "Vitest", aliases: [], related: ["jest"], family: "quality" },
  { key: "observability", label: "Observability", aliases: ["monitoring", "metrics", "tracing", "logging"], related: [], family: "quality" },
  { key: "performance", label: "Performance optimisation", aliases: ["performance optimisation", "performance optimization", "latency", "profiling"], related: [], family: "quality" },
  { key: "agile", label: "Agile", aliases: ["scrum", "kanban", "agile ceremonies"], related: [], family: "process" },

  // Data / ML
  { key: "pandas", label: "pandas", aliases: [], related: ["numpy"], family: "data" },
  { key: "numpy", label: "NumPy", aliases: [], related: ["pandas"], family: "data" },
  { key: "statistics", label: "Statistics", aliases: ["statistical analysis", "statistical modelling", "stats"], related: ["data-analysis"], family: "data" },
  { key: "data-analysis", label: "Data analysis", aliases: ["data analytics", "exploratory data analysis", "data analysis"], related: ["statistics"], family: "data" },
  { key: "machine-learning", label: "Machine learning", aliases: ["machine learning", "ml models", "ml"], related: ["deep-learning"], family: "ml" },
  { key: "deep-learning", label: "Deep learning", aliases: ["deep learning", "neural networks"], related: ["machine-learning"], family: "ml" },
  { key: "pytorch", label: "PyTorch", aliases: ["torch"], related: ["tensorflow"], family: "ml" },
  { key: "tensorflow", label: "TensorFlow", aliases: ["tf"], related: ["pytorch"], family: "ml" },
  { key: "nlp", label: "NLP", aliases: ["natural language processing"], related: ["machine-learning"], family: "ml" },
  { key: "sql-analytics", label: "Analytics SQL", aliases: ["analytical sql", "window functions"], related: ["sql"], implements: ["sql"], family: "data" },
];

export const SKILL_BY_KEY: Record<string, SkillEntry> = Object.fromEntries(
  SKILL_TAXONOMY.map((entry) => [entry.key, entry]),
);

/** Characters that may legally appear inside a skill token. */
const TOKEN_EDGE = "[^a-z0-9+#.]";
/** Trailing side: a sentence-ending full stop is allowed, a token is not. */
const TOKEN_END = "[^a-z0-9+#]";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-token match helper. Boundaries rather than substring matching, so
 * "React" never matches "ReactiveX", a bare "C" never matches "Café" and "sql"
 * never matches inside "postgresql". The trailing side accepts a full stop so
 * a term at the end of a sentence still counts. Deliberately avoids regex
 * lookbehind (not supported by every browser).
 */
export function mentionsTerm(text: string, term: string): boolean {
  const trimmed = term.trim();
  if (!trimmed) return false;
  const pattern = new RegExp(
    `(^|${TOKEN_EDGE})${escapeRegExp(trimmed.toLowerCase())}($|${TOKEN_END})`,
    "i",
  );
  return pattern.test(text);
}

/** True when `text` mentions this skill by its label or any alias. */
export function mentionsSkill(text: string, skill: SkillEntry): boolean {
  return [skill.label, ...skill.aliases].some((term) =>
    mentionsTerm(text, term),
  );
}

export function findSkillByTerm(term: string): SkillEntry | null {
  const needle = term.trim().toLowerCase();
  if (!needle) return null;
  for (const skill of SKILL_TAXONOMY) {
    if (skill.key === needle) return skill;
    if (skill.label.toLowerCase() === needle) return skill;
    if (skill.aliases.some((alias) => alias.toLowerCase() === needle)) {
      return skill;
    }
  }
  return null;
}

/** Skills adjacent to `key` (never equivalents, PRD §4.3). */
export function relatedSkills(key: string): SkillEntry[] {
  const skill = SKILL_BY_KEY[key];
  if (!skill) return [];
  return skill.related
    .map((related) => SKILL_BY_KEY[related])
    .filter((entry): entry is SkillEntry => Boolean(entry));
}

/**
 * Concrete skills that *are* this general skill (e.g. PostgreSQL for SQL).
 * Evidence of one of these satisfies the general requirement; the reverse is
 * only ever `related`, never a match.
 */
export function implementerSkills(key: string): SkillEntry[] {
  return SKILL_TAXONOMY.filter((entry) => entry.implements?.includes(key));
}

/** Other skills in the same coarse neighbourhood. */
export function sameFamilySkills(key: string): SkillEntry[] {
  const skill = SKILL_BY_KEY[key];
  if (!skill) return [];
  return SKILL_TAXONOMY.filter(
    (entry) => entry.family === skill.family && entry.key !== skill.key,
  );
}
