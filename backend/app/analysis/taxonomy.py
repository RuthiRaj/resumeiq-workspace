"""Skill taxonomy for requirement matching (PRD §4.3).

Port of ``frontend/src/lib/analysis/taxonomy.ts``. Two different relations live
here, and they are not interchangeable:

* ``related`` is deliberately *not* equivalence: JavaScript is not TypeScript,
  React is not Angular, Docker is not Kubernetes, ML is not DL and
  C != C++ != C#. A related skill can never produce a **matched** requirement;
  it can only make an unsupported one "not evidenced yet" -- enforced in
  ``matching.py`` and locked down by the parity tests.
* ``implements`` *is* equivalence, in one direction only. Some entries name a
  general capability ("SQL") that other entries are concrete forms of
  ("PostgreSQL is a SQL engine"). Evidence of the concrete form therefore
  satisfies the general requirement. The reverse never holds: an "MySQL"
  requirement with only "SQL" evidence stays unsupported, because knowing SQL
  does not tell us which engine you have used.

``family`` is a coarse neighbourhood ("frontend", "cloud", "language"...) used
only to decide whether an unsupported requirement is *not evidenced yet* (you
work in the area, it may be undocumented) or *genuinely missing*.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class SkillEntry:
    """One skill in the taxonomy."""

    #: Stable key; also used to build deterministic requirement ids.
    key: str
    #: Canonical display label.
    label: str
    #: Alternative spellings that mean the same thing.
    aliases: list[str] = field(default_factory=list)
    #: Adjacent skills -- related, never equivalent (PRD §4.3).
    related: list[str] = field(default_factory=list)
    #: Keys of the general skills this entry is a concrete form of.
    implements: list[str] | None = None
    family: str = ""
    #: True for single letters/very short terms needing exact-token matches.
    short: bool = False


SKILL_TAXONOMY: list[SkillEntry] = [
    # Languages
    SkillEntry("typescript", "TypeScript", ["ts", "type script"], ["javascript"], None, "language"),
    SkillEntry(
        "javascript", "JavaScript", ["js", "ecmascript", "es6"], ["typescript"], None, "language"
    ),
    SkillEntry("python", "Python", ["py"], [], None, "language"),
    SkillEntry("java", "Java", [], ["kotlin"], None, "language"),
    SkillEntry("kotlin", "Kotlin", [], ["java"], None, "language"),
    SkillEntry("csharp", "C#", ["c sharp", "csharp"], ["dotnet"], None, "language"),
    SkillEntry("dotnet", ".NET", ["dotnet", "asp.net", ".net core"], ["csharp"], None, "framework"),
    SkillEntry("cpp", "C++", ["c plus plus", "cpp"], ["c"], None, "language"),
    SkillEntry("c", "C", [], ["cpp"], None, "language", True),
    SkillEntry("go", "Go", ["golang"], [], None, "language", True),
    SkillEntry("rust", "Rust", [], [], None, "language"),
    SkillEntry("php", "PHP", [], [], None, "language"),
    SkillEntry("ruby", "Ruby", [], [], None, "language"),
    SkillEntry("swift", "Swift", [], ["objective-c"], None, "language"),
    SkillEntry(
        "sql",
        "SQL",
        ["sql queries", "sql query"],
        ["postgresql", "mysql", "sqlite"],
        None,
        "database",
    ),
    SkillEntry("r", "R", [], [], None, "language", True),
    # Frontend
    SkillEntry("react", "React", ["react.js", "reactjs"], ["vue", "angular"], None, "frontend"),
    SkillEntry("vue", "Vue", ["vue.js", "vuejs"], ["react", "angular"], None, "frontend"),
    SkillEntry("angular", "Angular", ["angularjs"], ["react", "vue"], None, "frontend"),
    SkillEntry("nextjs", "Next.js", ["next.js", "nextjs", "next js"], ["react"], None, "frontend"),
    SkillEntry("html", "HTML", ["html5"], ["css"], None, "frontend"),
    SkillEntry("css", "CSS", ["css3"], ["html", "tailwindcss"], None, "frontend"),
    SkillEntry(
        "tailwindcss",
        "Tailwind CSS",
        ["tailwind", "tailwindcss", "tailwind ui"],
        ["css"],
        None,
        "frontend",
    ),
    SkillEntry(
        "accessibility", "Accessibility", ["a11y", "wcag", "accessible"], ["html"], None, "frontend"
    ),
    SkillEntry("figma", "Figma", [], [], None, "design"),
    SkillEntry("threejs", "Three.js", ["three.js", "threejs", "r3f"], ["webgl"], None, "frontend"),
    SkillEntry("webgl", "WebGL", [], ["threejs"], None, "frontend"),
    # Backend / platform
    SkillEntry(
        "nodejs", "Node.js", ["node.js", "nodejs", "node js"], ["javascript"], None, "backend"
    ),
    SkillEntry("fastapi", "FastAPI", [], ["python"], None, "backend"),
    SkillEntry("django", "Django", [], ["python"], None, "backend"),
    SkillEntry("flask", "Flask", [], ["python"], None, "backend"),
    SkillEntry("spring", "Spring", ["spring boot"], ["java"], None, "backend"),
    SkillEntry("graphql", "GraphQL", [], ["rest"], None, "backend"),
    SkillEntry(
        "rest",
        "REST APIs",
        ["rest api", "restful", "rest apis", "rest"],
        ["graphql"],
        None,
        "backend",
    ),
    SkillEntry("grpc", "gRPC", [], ["rest"], None, "backend"),
    SkillEntry(
        "postgresql",
        "PostgreSQL",
        ["postgres", "postgresql", "pg"],
        ["sql", "mysql", "sqlite"],
        ["sql"],
        "database",
    ),
    SkillEntry("mysql", "MySQL", ["mariadb"], ["sql", "postgresql"], ["sql"], "database"),
    SkillEntry("sqlite", "SQLite", [], ["sql", "postgresql"], ["sql"], "database"),
    SkillEntry("mongodb", "MongoDB", ["mongo", "mongodb"], [], None, "database"),
    SkillEntry("redis", "Redis", [], [], None, "database"),
    SkillEntry("kafka", "Kafka", ["apache kafka"], [], None, "infrastructure"),
    SkillEntry("docker", "Docker", [], ["kubernetes"], None, "infrastructure"),
    SkillEntry("kubernetes", "Kubernetes", ["k8s", "kube"], ["docker"], None, "infrastructure"),
    SkillEntry("terraform", "Terraform", [], [], None, "infrastructure"),
    SkillEntry(
        "aws", "AWS", ["amazon web services", "amazon aws"], ["gcp", "azure"], None, "cloud"
    ),
    SkillEntry(
        "gcp", "Google Cloud", ["gcp", "google cloud platform"], ["aws", "azure"], None, "cloud"
    ),
    SkillEntry("azure", "Azure", ["microsoft azure"], ["aws", "gcp"], None, "cloud"),
    SkillEntry("linux", "Linux", ["unix"], [], None, "infrastructure"),
    SkillEntry("git", "Git", [], ["github"], None, "tooling"),
    SkillEntry("github", "GitHub", ["github actions", "gh actions"], ["git"], None, "tooling"),
    SkillEntry(
        "cicd",
        "CI/CD",
        [
            "ci cd",
            "ci/cd",
            "continuous integration",
            "continuous delivery",
            "continuous deployment",
        ],
        ["github"],
        None,
        "tooling",
    ),
    SkillEntry(
        "testing",
        "Automated testing",
        [
            "unit testing",
            "test automation",
            "integration tests",
            "integration testing",
            "automated tests",
        ],
        [],
        None,
        "quality",
    ),
    SkillEntry("playwright", "Playwright", [], [], None, "quality"),
    SkillEntry("cypress", "Cypress", [], ["playwright"], None, "quality"),
    SkillEntry("jest", "Jest", [], ["vitest"], None, "quality"),
    SkillEntry("vitest", "Vitest", [], ["jest"], None, "quality"),
    SkillEntry(
        "observability",
        "Observability",
        ["monitoring", "metrics", "tracing", "logging"],
        [],
        None,
        "quality",
    ),
    SkillEntry(
        "performance",
        "Performance optimisation",
        ["performance optimisation", "performance optimization", "latency", "profiling"],
        [],
        None,
        "quality",
    ),
    SkillEntry("agile", "Agile", ["scrum", "kanban", "agile ceremonies"], [], None, "process"),
    # Data / ML
    SkillEntry("pandas", "pandas", [], ["numpy"], None, "data"),
    SkillEntry("numpy", "NumPy", [], ["pandas"], None, "data"),
    SkillEntry(
        "statistics",
        "Statistics",
        ["statistical analysis", "statistical modelling", "stats"],
        ["data-analysis"],
        None,
        "data",
    ),
    SkillEntry(
        "data-analysis",
        "Data analysis",
        ["data analytics", "exploratory data analysis", "data analysis"],
        ["statistics"],
        None,
        "data",
    ),
    SkillEntry(
        "machine-learning",
        "Machine learning",
        ["machine learning", "ml models", "ml"],
        ["deep-learning"],
        None,
        "ml",
    ),
    SkillEntry(
        "deep-learning",
        "Deep learning",
        ["deep learning", "neural networks"],
        ["machine-learning"],
        None,
        "ml",
    ),
    SkillEntry("pytorch", "PyTorch", ["torch"], ["tensorflow"], None, "ml"),
    SkillEntry("tensorflow", "TensorFlow", ["tf"], ["pytorch"], None, "ml"),
    SkillEntry("nlp", "NLP", ["natural language processing"], ["machine-learning"], None, "ml"),
    SkillEntry(
        "sql-analytics",
        "Analytics SQL",
        ["analytical sql", "window functions"],
        ["sql"],
        ["sql"],
        "data",
    ),
]

SKILL_BY_KEY: dict[str, SkillEntry] = {entry.key: entry for entry in SKILL_TAXONOMY}

#: Characters that may legally appear inside a skill token.
_TOKEN_EDGE = "[^a-z0-9+#.]"
#: Trailing side: a sentence-ending full stop is allowed, a token is not.
_TOKEN_END = "[^a-z0-9+#]"

_ESCAPE_RE = re.compile(r"[.*+?^${}()|\[\]\\]")


def _escape_regexp(value: str) -> str:
    """Escape a literal for use inside a regex (JS ``escapeRegExp`` equivalent)."""
    return _ESCAPE_RE.sub(lambda match: "\\" + match.group(0), value)


def mentions_term(text: str, term: str) -> bool:
    """Whole-token match helper.

    Boundaries rather than substring matching, so "React" never matches
    "ReactiveX", a bare "C" never matches "Cafe" and "sql" never matches inside
    "postgresql". The trailing side accepts a full stop so a term at the end of
    a sentence still counts.
    """
    trimmed = term.strip()
    if not trimmed:
        return False
    pattern = f"(^|{_TOKEN_EDGE}){_escape_regexp(trimmed.lower())}($|{_TOKEN_END})"
    return re.search(pattern, text, re.IGNORECASE) is not None


def mentions_skill(text: str, skill: SkillEntry) -> bool:
    """True when ``text`` mentions this skill by its label or any alias."""
    return any(mentions_term(text, term) for term in [skill.label, *skill.aliases])


def find_skill_by_term(term: str) -> SkillEntry | None:
    needle = term.strip().lower()
    if not needle:
        return None
    for skill in SKILL_TAXONOMY:
        if skill.key == needle:
            return skill
        if skill.label.lower() == needle:
            return skill
        if any(alias.lower() == needle for alias in skill.aliases):
            return skill
    return None


def related_skills(key: str) -> list[SkillEntry]:
    """Skills adjacent to ``key`` (never equivalents, PRD §4.3)."""
    skill = SKILL_BY_KEY.get(key)
    if skill is None:
        return []
    return [SKILL_BY_KEY[related] for related in skill.related if related in SKILL_BY_KEY]


def implementer_skills(key: str) -> list[SkillEntry]:
    """Concrete skills that *are* this general skill (e.g. PostgreSQL for SQL).

    Evidence of one of these satisfies the general requirement; the reverse is
    only ever ``related``, never a match.
    """
    return [entry for entry in SKILL_TAXONOMY if entry.implements and key in entry.implements]


def same_family_skills(key: str) -> list[SkillEntry]:
    """Other skills in the same coarse neighbourhood."""
    skill = SKILL_BY_KEY.get(key)
    if skill is None:
        return []
    return [
        entry for entry in SKILL_TAXONOMY if entry.family == skill.family and entry.key != skill.key
    ]
