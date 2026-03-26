'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { SubNav } from '@/components/SubNav';
import { Search, Server, ExternalLink, Download, Package, RefreshCw, ChevronRight, Check, Star, BookOpen, GitBranch, Cpu, Shield, Brain, Wrench, Code } from 'lucide-react';

interface McpServer {
  name: string;
  description?: string;
  repository?: { url?: string };
  version?: string;
  packages?: Record<string, {
    registry_name?: string;
    name?: string;
  }>;
  remotes?: { type?: string; url?: string }[];
}

interface McpResponse {
  servers: McpServer[];
  next_cursor?: string;
}

// Curated persona templates from the community
const COMMUNITY_PERSONAS = [
  {
    name: 'full-stack-dev',
    description: 'Senior full-stack developer. Writes clean TypeScript, React, Next.js, and Node.js code with proper error handling and tests.',
    type: 'claude' as const,
    model: 'sonnet',
    tags: ['development', 'typescript', 'react'],
    prompt: 'You are a senior full-stack developer. Write clean, maintainable TypeScript code following best practices. Use React with hooks, Next.js app router patterns, and Node.js with proper async/await error handling. Always include appropriate error boundaries and loading states. Write tests for critical paths.',
  },
  {
    name: 'api-designer',
    description: 'REST and GraphQL API architect. Designs clean, well-documented endpoints with proper validation and error responses.',
    type: 'claude' as const,
    model: 'sonnet',
    tags: ['api', 'backend', 'architecture'],
    prompt: 'You are an API design expert. Design RESTful APIs with proper HTTP methods, status codes, and error responses. Use Zod or similar for input validation. Document endpoints with OpenAPI/Swagger. Consider pagination, filtering, rate limiting, and versioning. For GraphQL, design schemas with proper types, resolvers, and error handling.',
  },
  {
    name: 'devops-engineer',
    description: 'Infrastructure and CI/CD specialist. Writes Dockerfiles, GitHub Actions, Terraform, and Kubernetes configs.',
    type: 'claude' as const,
    model: 'sonnet',
    tags: ['devops', 'docker', 'ci-cd'],
    prompt: 'You are a DevOps engineer. Write efficient Dockerfiles with multi-stage builds and proper layer caching. Create GitHub Actions workflows for CI/CD. Write Terraform configs for cloud infrastructure. Configure Kubernetes deployments with proper resource limits, health checks, and rolling updates. Follow security best practices for secrets management.',
  },
  {
    name: 'performance-optimizer',
    description: 'Identifies and fixes performance bottlenecks. Profiles React renders, optimizes SQL queries, reduces bundle size.',
    type: 'claude' as const,
    model: 'sonnet',
    tags: ['performance', 'optimization'],
    prompt: 'You are a performance optimization specialist. Profile and fix React rendering bottlenecks (unnecessary re-renders, missing memoization, large component trees). Optimize SQL queries (missing indexes, N+1 problems, query planning). Reduce JavaScript bundle sizes (code splitting, tree shaking, lazy loading). Implement caching strategies (Redis, CDN, browser cache headers). Measure before and after.',
  },
  {
    name: 'accessibility-auditor',
    description: 'WCAG 2.1 compliance checker. Audits components for keyboard navigation, screen reader support, and color contrast.',
    type: 'claude' as const,
    model: 'haiku',
    tags: ['accessibility', 'a11y', 'wcag'],
    prompt: 'You are an accessibility expert. Audit code for WCAG 2.1 AA compliance. Check for proper ARIA attributes, keyboard navigation, focus management, color contrast ratios, screen reader compatibility, and semantic HTML. Test with common assistive technologies in mind. Provide actionable fixes with code examples.',
  },
  {
    name: 'database-architect',
    description: 'Schema design and query optimization. PostgreSQL, MySQL, MongoDB, and Redis expertise.',
    type: 'claude' as const,
    model: 'sonnet',
    tags: ['database', 'sql', 'schema'],
    prompt: 'You are a database architect. Design normalized schemas with proper indexes, constraints, and relationships. Write efficient queries avoiding full table scans. Implement migration strategies for zero-downtime deployments. Choose appropriate data types and storage engines. Design caching layers with Redis. Handle concurrent access patterns safely.',
  },
  {
    name: 'technical-writer',
    description: 'Creates clear, concise documentation. READMEs, API docs, architecture decision records, and onboarding guides.',
    type: 'claude' as const,
    model: 'haiku',
    tags: ['documentation', 'writing'],
    prompt: 'You are a technical writer. Create clear, scannable documentation. Write READMEs with quick start sections, usage examples, and configuration references. Document APIs with request/response examples. Write architecture decision records (ADRs) explaining trade-offs. Create onboarding guides that get new developers productive fast. Avoid jargon. Use code blocks and tables.',
  },
  {
    name: 'migration-specialist',
    description: 'Handles framework upgrades, language migrations, and dependency updates with zero downtime.',
    type: 'claude' as const,
    model: 'sonnet',
    tags: ['migration', 'upgrade'],
    prompt: 'You are a migration specialist. Plan and execute framework upgrades (React 17→18, Next.js pages→app router, Express→Fastify). Handle language migrations (JavaScript→TypeScript, Python 2→3). Update dependencies with breaking changes. Create codemods for repetitive transformations. Maintain backward compatibility during transitions. Write migration guides for the team.',
  },
  {
    name: 'data-engineer',
    description: 'Designs data pipelines, ETL processes, warehouses, and streaming architectures with dbt, Airflow, Spark.',
    type: 'claude' as const,
    model: 'sonnet',
    tags: ['data', 'etl', 'pipelines', 'sql'],
    prompt: 'You are a senior data engineer. Design ETL/ELT pipelines (dbt, Airflow, Prefect). Build data warehouses (Snowflake, BigQuery, DuckDB). Implement streaming systems (Kafka, Flink). Always consider idempotency, exactly-once semantics, observability, and data quality. Prefer incremental loads over full refreshes. Document schema contracts.',
  },
  {
    name: 'ml-engineer',
    description: 'Builds production ML systems: training pipelines, model serving, feature stores, monitoring, and MLOps.',
    type: 'claude' as const,
    model: 'sonnet',
    tags: ['ml', 'ai', 'python', 'pytorch'],
    prompt: 'You are a senior ML engineer. Build training pipelines (PyTorch, HuggingFace). Deploy models (vLLM, TorchServe, BentoML). Implement feature stores and evaluation frameworks. Check for training/serving skew, data leakage. Ensure reproducibility with pinned deps and artifact versioning. Monitor model drift in production.',
  },
  {
    name: 'security-pentester',
    description: 'Performs security assessments, finds OWASP vulnerabilities, and provides actionable remediation with PoCs.',
    type: 'claude' as const,
    model: 'sonnet',
    tags: ['security', 'pentesting', 'owasp'],
    prompt: 'You are a senior application security engineer. Audit for OWASP Top 10 (injection, auth flaws, IDOR, SSRF, XXE). Review APIs for auth bypass, rate limiting, mass assignment. Perform secure code review. Think like an attacker. Prioritize by CVSS score. Give concrete PoC descriptions and specific remediation code, not vague warnings.',
  },
  {
    name: 'mobile-developer',
    description: 'Builds React Native and Expo apps with native integrations, animations, and App Store deployment.',
    type: 'claude' as const,
    model: 'sonnet',
    tags: ['mobile', 'react-native', 'expo', 'ios'],
    prompt: 'You are a senior mobile developer specializing in React Native and Expo. Use new architecture (JSI, Fabric, TurboModules). Build with Expo Router and EAS. Use Reanimated 3 for animations. Test at 375px (iPhone SE) and 390px (iPhone 16). Use Pressable over TouchableOpacity. Handle offline states gracefully. Test on real devices before submitting.',
  },
  {
    name: 'ui-ux-reviewer',
    description: 'Reviews interfaces for usability, consistency, accessibility, and conversion optimization.',
    type: 'claude' as const,
    model: 'haiku',
    tags: ['design', 'ux', 'accessibility'],
    prompt: 'You are a senior UX reviewer. Evaluate against Nielsen heuristics, WCAG 2.1 AA, and conversion best practices. Check contrast ratios, focus states, touch targets (min 44x44px), and information architecture. Be specific, cite exact components. Prioritize: critical (blocks users) > major (frustrates) > minor (polish). Suggest concrete fixes with before/after.',
  },
  {
    name: 'code-reviewer-pro',
    description: 'Thorough code reviews for correctness, security, performance, maintainability, and test coverage.',
    type: 'claude' as const,
    model: 'haiku',
    tags: ['review', 'quality', 'best-practices'],
    prompt: 'You are a meticulous code reviewer. Check for: logic bugs, race conditions, null handling, injection, auth gaps, N+1 queries, memory leaks, naming clarity, DRY violations, SOLID principles, test coverage. Lead with critical issues. Provide corrected code snippets. Distinguish blocking issues from suggestions. Acknowledge good decisions.',
  },
  {
    name: 'project-manager',
    description: 'Breaks features into tickets, estimates effort, manages scope, writes specs with acceptance criteria.',
    type: 'claude' as const,
    model: 'haiku',
    tags: ['pm', 'planning', 'agile', 'specs'],
    prompt: 'You are a technical PM. Write feature specs with clear acceptance criteria and out-of-scope boundaries. Break epics into tickets (Jira/Linear format) with story points. Provide effort estimates with confidence intervals. Surface blockers early. Every user story includes "so that..." not just "I want...". Done means deployed and monitored, not just merged.',
  },
  {
    name: 'platform-engineer',
    description: 'Builds internal developer platforms, golden paths, CI/CD pipelines, and self-service infrastructure.',
    type: 'claude' as const,
    model: 'sonnet',
    tags: ['platform', 'devops', 'terraform', 'kubernetes'],
    prompt: 'You are a senior platform engineer. Build golden path templates, IaC (Terraform, Pulumi), CI/CD (GitHub Actions), K8s platform layer (ArgoCD, operators). Set up observability (OpenTelemetry, Prometheus, Grafana). Manage secrets (Vault, SOPS). Make the right way the easy way. Treat your platform as a product. Automate anything done more than twice.',
  },
  {
    name: 'qa-automation',
    description: 'Designs test strategies, writes automated suites, and builds quality gates into CI/CD pipelines.',
    type: 'claude' as const,
    model: 'haiku',
    tags: ['qa', 'testing', 'playwright', 'vitest'],
    prompt: 'You are a senior QA automation engineer. Write tests across the pyramid: 70% unit (Vitest/Jest), 20% integration (Testing Library), 10% E2E (Playwright). Set up visual regression (Percy/Chromatic). Build performance tests (k6). Test behavior not implementation. Flaky tests are worse than no tests. CI gate under 5 min for unit+integration.',
  },
  {
    name: 'devrel-engineer',
    description: 'Creates technical tutorials, API docs, sample apps, and developer community content.',
    type: 'claude' as const,
    model: 'sonnet',
    tags: ['devrel', 'docs', 'tutorials', 'api'],
    prompt: 'You are a developer relations engineer. Write getting-started guides that work on first try. Create API reference with real examples and error docs. Build tutorials that scaffold to working app in under 15 min. Every code sample must be copy-paste runnable. Show errors explicitly. Use realistic variable names. Keep it scannable with headers and code blocks.',
  },
];

const TAG_COLORS: Record<string, string> = {
  development: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  typescript: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  react: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  api: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  backend: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  architecture: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  devops: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  docker: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  'ci-cd': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  performance: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  optimization: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  accessibility: 'bg-green-500/10 text-green-400 border-green-500/20',
  a11y: 'bg-green-500/10 text-green-400 border-green-500/20',
  wcag: 'bg-green-500/10 text-green-400 border-green-500/20',
  database: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  sql: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  schema: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  documentation: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  writing: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  migration: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  upgrade: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  data: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  etl: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  pipelines: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  ml: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  ai: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  python: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  pytorch: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  security: 'bg-red-500/10 text-red-400 border-red-500/20',
  pentesting: 'bg-red-500/10 text-red-400 border-red-500/20',
  owasp: 'bg-red-500/10 text-red-400 border-red-500/20',
  mobile: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  'react-native': 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  expo: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  ios: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  ux: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  review: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  'best-practices': 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  pm: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  planning: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  agile: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  specs: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  platform: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  terraform: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  kubernetes: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  qa: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  testing: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  playwright: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  vitest: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  devrel: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  tutorials: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};

// --- Anthropic Official Skills ---
interface CuratedSkill {
  name: string;
  description: string;
  url: string;
  category: string;
  installs?: string;
}

const OFFICIAL_SKILLS: CuratedSkill[] = [
  { name: 'PDF Processing', description: 'Read, extract tables, fill forms, merge/split PDFs', url: 'https://github.com/anthropics/skills/tree/main/skills/pdf', category: 'document' },
  { name: 'DOCX', description: 'Create and edit Word docs with tracked changes, comments, formatting', url: 'https://github.com/anthropics/skills/tree/main/skills/docx', category: 'document' },
  { name: 'PPTX', description: 'Slide decks from natural language with layouts, charts, speaker notes', url: 'https://github.com/anthropics/skills/tree/main/skills/pptx', category: 'document' },
  { name: 'XLSX', description: 'Formulas, analysis, charts via plain English', url: 'https://github.com/anthropics/skills/tree/main/skills/xlsx', category: 'document' },
  { name: 'Doc Co-Authoring', description: 'Real collaborative writing between human and Claude', url: 'https://github.com/anthropics/skills/tree/main/skills/doc-coauthoring', category: 'document' },
  { name: 'Frontend Design', description: 'Real design systems, bold typography. 277k+ installs', url: 'https://github.com/anthropics/skills/tree/main/skills/frontend-design', category: 'design', installs: '277k+' },
  { name: 'Canvas Design', description: 'Social graphics, posters, covers from text to PNG/PDF', url: 'https://github.com/anthropics/skills/tree/main/skills/canvas-design', category: 'design' },
  { name: 'Algorithmic Art', description: 'Fractal patterns, geometric compositions via p5.js', url: 'https://github.com/anthropics/skills/tree/main/skills/algorithmic-art', category: 'design' },
  { name: 'Theme Factory', description: 'Batch-generate color schemes from one prompt', url: 'https://github.com/anthropics/skills/tree/main/skills/theme-factory', category: 'design' },
  { name: 'Web Artifacts Builder', description: 'Calculators, dashboards via natural language', url: 'https://github.com/anthropics/skills/tree/main/skills/web-artifacts-builder', category: 'design' },
  { name: 'Superpowers', description: '20+ battle-tested skills: TDD, debugging, plan-to-execute. 96k+ stars', url: 'https://github.com/obra/superpowers', category: 'dev', installs: '96k+' },
  { name: 'Systematic Debugging', description: 'Root cause analysis first, fix second. 4-phase methodology', url: 'https://github.com/obra/superpowers', category: 'dev' },
  { name: 'Context Optimization', description: 'Reduce token costs with KV-cache tricks. 13.9k stars', url: 'https://github.com/muratcankoylan/agent-skills-for-context-engineering', category: 'dev' },
  { name: 'Skill Creator', description: 'Meta-skill: describe a workflow, get a SKILL.md in 5 min', url: 'https://github.com/anthropics/skills/tree/main/skills/skill-creator', category: 'dev' },
  { name: 'Brand Guidelines', description: 'Encode your brand into a skill, auto-applies everywhere', url: 'https://github.com/anthropics/skills/tree/main/skills/brand-guidelines', category: 'marketing' },
  { name: 'Marketing Skills', description: '20+ skills: CRO, copywriting, SEO, email sequences, growth', url: 'https://github.com/coreyhaines31/marketingskills', category: 'marketing' },
  { name: 'Claude SEO', description: 'Full-site audits, schema validation with 12 sub-skills', url: 'https://github.com/AgriciDaniel/claude-seo', category: 'marketing' },
  { name: 'Obsidian Skills', description: "By Obsidian's CEO. Auto-tagging, auto-linking, vault-native", url: 'https://github.com/kepano/obsidian-skills', category: 'knowledge' },
  { name: 'Deep Research Skill', description: '8-phase research with auto-continuation', url: 'https://github.com/199-biotechnologies/claude-deep-research-skill', category: 'knowledge' },
  // Official Anthropic — new
  { name: 'MCP Builder', description: 'Guide for creating high-quality MCP servers to integrate external APIs and tools', url: 'https://github.com/anthropics/skills/tree/main/skills/mcp-builder', category: 'dev' },
  { name: 'Webapp Testing', description: 'Test local web apps using Playwright for UI verification and automated browser testing', url: 'https://github.com/anthropics/skills/tree/main/skills/webapp-testing', category: 'dev' },
  { name: 'Internal Comms', description: 'Write internal communications like status reports, memos, and team newsletters', url: 'https://github.com/anthropics/skills/tree/main/skills/internal-comms', category: 'marketing' },
  { name: 'Slack GIF Creator', description: "Create animated GIFs optimized for Slack's size constraints", url: 'https://github.com/anthropics/skills/tree/main/skills/slack-gif-creator', category: 'design' },
  // Community skills
  { name: 'Trail of Bits Security', description: 'Security-focused skills for static analysis, variant analysis, and smart contract auditing', url: 'https://github.com/trailofbits/skills', category: 'security' },
  { name: 'iOS Simulator Skill', description: 'Build, navigate, and test iOS apps through Simulator automation from Claude Code', url: 'https://github.com/conorluddy/ios-simulator-skill', category: 'mobile' },
  { name: 'Expo Skills', description: 'Official Expo team skills for building, deploying, and debugging React Native apps', url: 'https://github.com/expo/skills', category: 'mobile' },
  { name: 'Playwright Skill', description: 'Browser automation using Playwright for navigation, clicks, screenshots, scraping', url: 'https://github.com/lackeyjb/playwright-skill', category: 'dev' },
  { name: 'D3.js Visualization', description: 'Create interactive data visualizations using D3.js with correct API patterns', url: 'https://github.com/chrisvoncsefalvay/claude-d3js-skill', category: 'design' },
  { name: 'Scientific Skills', description: 'Ready-to-use scientific computation and research skills collection', url: 'https://github.com/K-Dense-AI/claude-scientific-skills', category: 'knowledge' },
  { name: 'Web Asset Generator', description: 'Generate favicons, app icons, og-images, and social media images from one source', url: 'https://github.com/alonw0/web-asset-generator', category: 'design' },
  { name: 'Frontend Slides', description: 'Create animation-rich HTML presentations or convert PowerPoint to web slideshows', url: 'https://github.com/zarazhangrui/frontend-slides', category: 'design' },
  { name: 'FFUF Web Fuzzing', description: 'Expert guidance for ffuf web fuzzing during pentesting and security assessments', url: 'https://github.com/jthack/ffuf_claude_skill', category: 'security' },
  { name: 'shadcn/ui Skill', description: 'Context on all shadcn/ui components, patterns, and enforces consistent usage', url: 'https://ui.shadcn.com/docs/skills', category: 'dev' },
  { name: 'Remotion Video', description: 'AI video generation best practices. 117k weekly installs', url: 'https://github.com/remotion-dev/remotion', category: 'design', installs: '117k+' },
];

const SKILL_CATEGORIES: Record<string, { label: string; color: string }> = {
  document: { label: 'Document & Office', color: 'text-blue-400' },
  design: { label: 'Design & Creative', color: 'text-pink-400' },
  security: { label: 'Security', color: 'text-red-400' },
  mobile: { label: 'Mobile', color: 'text-cyan-400' },
  dev: { label: 'Dev & Engineering', color: 'text-emerald-400' },
  marketing: { label: 'Marketing & SEO', color: 'text-amber-400' },
  knowledge: { label: 'Knowledge & Learning', color: 'text-purple-400' },
};

// --- Curated MCP Servers ---
interface CuratedMcp {
  name: string;
  description: string;
  url: string;
  installCmd?: string;
}

const CURATED_MCP: CuratedMcp[] = [
  { name: 'Tavily', description: 'Search engine built for AI agents. Clean structured data, not blue links. Search, extract, crawl, map.', url: 'https://github.com/tavily-ai/tavily-mcp', installCmd: 'npx tavily-mcp' },
  { name: 'Context7', description: 'Injects up-to-date library docs into context. No more hallucinated APIs. Supports Next.js, React, Supabase, MongoDB.', url: 'https://github.com/upstash/context7', installCmd: 'npx @upstash/context7-mcp' },
  { name: 'Task Master AI', description: 'Feed a PRD, get structured tasks with dependencies, Claude executes one by one. Works across Cursor, Claude Code, Windsurf.', url: 'https://github.com/eyaltoledano/claude-task-master', installCmd: 'npx task-master-ai' },
  { name: 'Playwright MCP', description: 'Browser automation for LLMs. Navigate, click, fill forms, take screenshots.', url: 'https://github.com/executeautomation/mcp-playwright', installCmd: 'npx @playwright/mcp' },
  { name: 'FastMCP', description: 'Build MCP servers in minimal Python. Fastest way to create custom tools.', url: 'https://github.com/jlowin/fastmcp', installCmd: 'pip install fastmcp' },
  { name: 'Markdownify MCP', description: 'Convert PDFs, images, audio to Markdown for LLM consumption.', url: 'https://github.com/zcaceres/markdownify-mcp' },
  { name: 'MCPHub', description: 'Manage multiple MCP servers via a single HTTP gateway.', url: 'https://github.com/samanhappy/mcphub' },
  { name: 'Excel MCP Server', description: 'Manipulate Excel spreadsheets without Microsoft Excel installed.', url: 'https://github.com/haris-musa/excel-mcp-server' },
  { name: 'Stealth Browser MCP', description: 'Undetectable browser automation for web scraping and interaction.', url: 'https://github.com/vibheksoni/stealth-browser-mcp' },
  { name: 'GitHub', description: 'Official GitHub MCP — manage repos, issues, PRs, code search, CI/CD workflows.', url: 'https://github.com/github/github-mcp-server', installCmd: 'docker run -i --rm ghcr.io/github/github-mcp-server' },
  { name: 'Notion', description: 'Official Notion MCP — search, read, create and edit pages and databases.', url: 'https://github.com/makenotion/notion-mcp-server', installCmd: 'npx -y @notionhq/notion-mcp-server' },
  { name: 'Slack', description: 'Read messages, search conversations, post content in Slack workspaces.', url: 'https://github.com/korotovsky/slack-mcp-server', installCmd: 'npx slack-mcp-server' },
  { name: 'Linear', description: 'Interact with Linear — retrieve issues, create tasks, update statuses, assign work.', url: 'https://github.com/tacticlaunch/mcp-linear', installCmd: 'npx -y @tacticlaunch/mcp-linear' },
  { name: 'Stripe', description: 'Manage payments, customers, subscriptions, invoices via Stripe API.', url: 'https://github.com/stripe/agent-toolkit', installCmd: 'npx -y @stripe/mcp' },
  { name: 'Supabase', description: 'Query databases, manage auth, trigger edge functions, browse storage.', url: 'https://github.com/supabase-community/supabase-mcp', installCmd: 'npx @supabase/mcp-server-supabase' },
  { name: 'Filesystem', description: 'Secure local file operations — read, write, move, search, get metadata.', url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem', installCmd: 'npx -y @modelcontextprotocol/server-filesystem' },
  { name: 'Docker', description: 'Run and manage Docker containers, deploy Compose stacks, stream logs.', url: 'https://github.com/QuantGeekDev/docker-mcp', installCmd: 'uvx docker-mcp' },
  { name: 'Kubernetes', description: 'Manage K8s clusters — get/describe/apply resources, scale deployments, Helm charts.', url: 'https://github.com/Flux159/mcp-server-kubernetes', installCmd: 'npx mcp-server-kubernetes' },
  { name: 'Git', description: 'Read, search, and manipulate local Git repos — log, diff, blame, branches.', url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git', installCmd: 'uvx mcp-server-git' },
  { name: 'Memory', description: 'Knowledge graph-based persistent memory — entities, relations, observations.', url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory', installCmd: 'npx -y @modelcontextprotocol/server-memory' },
  { name: 'Sequential Thinking', description: 'Structured multi-step reasoning — breaks complex problems into thought chains.', url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking', installCmd: 'npx -y @modelcontextprotocol/server-sequential-thinking' },
];

// --- GitHub Repos ---
interface CuratedRepo {
  name: string;
  description: string;
  url: string;
  stars?: string;
  category: string;
}

const CURATED_REPOS: CuratedRepo[] = [
  // Agent Orchestration
  { name: 'gstack', description: 'Claude Code as virtual engineering team', url: 'https://github.com/garrytan/gstack', category: 'orchestration' },
  { name: 'cmux', description: 'Multiple Claude agents in parallel', url: 'https://github.com/craigsc/cmux', category: 'orchestration' },
  { name: 'figaro', description: 'Orchestrate Claude agent fleets on desktop', url: 'https://github.com/byt3bl33d3r/figaro', category: 'orchestration' },
  { name: 'claude-squad', description: 'Terminal agents in parallel sessions', url: 'https://github.com/smtg-ai/claude-squad', category: 'orchestration' },
  { name: 'deer-flow', description: 'ByteDance. Sub-agents and sandboxes through skills', url: 'https://github.com/bytedance/deer-flow', category: 'orchestration' },
  { name: 'LangGraph', description: 'Agents as graphs. Multi-agent orchestration. 26.8k stars', url: 'https://github.com/langchain-ai/langgraph', stars: '26.8k', category: 'orchestration' },
  { name: 'CrewAI', description: 'Multi-agent with roles, goals, backstories', url: 'https://github.com/crewAIInc/crewAI', category: 'orchestration' },
  { name: 'Dify', description: 'Open-source LLM app builder. Workflows, RAG, agents all-in-one', url: 'https://github.com/langgenius/dify', category: 'orchestration' },
  // Infrastructure & Security
  { name: 'Ghost OS', description: 'AI agents operate every Mac app', url: 'https://github.com/ghostwright/ghost-os', category: 'infrastructure' },
  { name: 'e2b Desktop', description: 'Isolated virtual desktops for agents', url: 'https://github.com/e2b-dev/desktop', category: 'infrastructure' },
  { name: 'container-use', description: 'Dagger. Containerized environments for coding agents', url: 'https://github.com/dagger/container-use', category: 'infrastructure' },
  { name: 'promptfoo', description: 'Automated security testing for AI models', url: 'https://github.com/promptfoo/promptfoo', category: 'infrastructure' },
  { name: 'agent-governance-toolkit', description: 'Microsoft. Security middleware for agents', url: 'https://github.com/microsoft/agent-governance-toolkit', category: 'infrastructure' },
  // Dev Tools
  { name: 'DSPy', description: 'Program (not prompt) foundation models. Stanford', url: 'https://github.com/stanfordnlp/dspy', category: 'devtools' },
  { name: 'Spec Kit', description: 'GitHub. Spec-driven dev. Write specs, AI generates code. 50k+ stars', url: 'https://github.com/github/spec-kit', stars: '50k+', category: 'devtools' },
  { name: 'rendergit', description: 'Karpathy. Git repo to single file for humans and LLMs', url: 'https://github.com/karpathy/rendergit', category: 'devtools' },
  { name: 'pydantic-ai', description: 'Type-safe agent framework', url: 'https://github.com/pydantic/pydantic-ai', category: 'devtools' },
  { name: 'TDD Guard', description: 'Enforces test-first development for AI agents', url: 'https://github.com/nizos/tdd-guard', category: 'devtools' },
  // Memory & Context
  { name: 'Mem9', description: 'Memory system for AI agents', url: 'https://github.com/mem9-ai/mem9', category: 'memory' },
  { name: 'Codefire', description: 'Persistent memory for coding agents', url: 'https://github.com/websitebutlers/codefire-app', category: 'memory' },
  { name: 'Memobase', description: 'User profile memory for LLMs', url: 'https://github.com/memodb-io/memobase', category: 'memory' },
  { name: 'Codebase Memory MCP', description: 'Codebase to persistent knowledge graph', url: 'https://github.com/DeusData/codebase-memory-mcp', category: 'memory' },
  // Local AI
  { name: 'Ollama', description: 'Run LLMs locally with one command', url: 'https://github.com/ollama/ollama', category: 'local' },
  { name: 'Open WebUI', description: 'Self-hosted ChatGPT-like interface', url: 'https://github.com/open-webui/open-webui', category: 'local' },
  { name: 'LlamaFile', description: 'LLM as single executable. Zero dependencies', url: 'https://github.com/Mozilla-Ocho/llamafile', category: 'local' },
  { name: 'Unsloth', description: 'Fine-tune 2x faster, 70% less memory', url: 'https://github.com/unslothai/unsloth', category: 'local' },
  // Search & Data
  { name: 'GPT Researcher', description: 'Autonomous research into compiled reports', url: 'https://github.com/assafelovic/gpt-researcher', category: 'data' },
  { name: 'Firecrawl', description: 'Any website to LLM-ready data', url: 'https://github.com/mendableai/firecrawl', category: 'data' },
  { name: 'n8n', description: 'Open-source automation with 400+ integrations + AI nodes', url: 'https://github.com/n8n-io/n8n', category: 'data' },
];

const REPO_CATEGORIES: Record<string, { label: string; icon: typeof Cpu }> = {
  orchestration: { label: 'Agent Orchestration', icon: GitBranch },
  infrastructure: { label: 'Infrastructure & Security', icon: Shield },
  devtools: { label: 'Dev Tools', icon: Code },
  memory: { label: 'Memory & Context', icon: Brain },
  local: { label: 'Local AI', icon: Cpu },
  data: { label: 'Search & Data', icon: Wrench },
};

export default function MarketplacePage() {
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpSearch, setMcpSearch] = useState('');
  const [mcpCursor, setMcpCursor] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState('');

  const [personaSearch, setPersonaSearch] = useState('');
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<'all' | 'skills' | 'personas' | 'mcp-curated' | 'mcp' | 'repos'>('all');
  const [globalSearch, setGlobalSearch] = useState('');
  const [previewItem, setPreviewItem] = useState<{ type: string; name: string; description: string; prompt?: string; url?: string; installCmd?: string; tags?: string[]; category?: string; stars?: string } | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Fetch MCP servers
  const fetchMcp = useCallback((search = '', cursor = '') => {
    setMcpLoading(true);
    setMcpError('');
    const params = new URLSearchParams();
    params.set('source', 'mcp');
    if (search) params.set('q', search);
    if (cursor) params.set('cursor', cursor);

    fetch(`/api/marketplace?${params}`)
      .then(r => r.json())
      .then((data: McpResponse) => {
        if (cursor) {
          setMcpServers(prev => [...prev, ...(data.servers || [])]);
        } else {
          setMcpServers(data.servers || []);
        }
        setMcpCursor(data.next_cursor || null);
      })
      .catch(() => setMcpError('Failed to load MCP registry'))
      .finally(() => setMcpLoading(false));
  }, []);

  useEffect(() => {
    if (activeSection === 'mcp') {
      fetchMcp();
    }
  }, [activeSection, fetchMcp]);

  // Check which personas are already installed
  useEffect(() => {
    fetch('/api/agent-configs')
      .then(r => r.json())
      .then(data => {
        const slugs = new Set<string>((data.configs || []).map((c: { slug: string }) => c.slug));
        setInstalled(slugs);
      })
      .catch(() => {});
  }, []);

  const handleMcpSearch = (q: string) => {
    setMcpSearch(q);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setMcpCursor(null);
      fetchMcp(q);
    }, 400);
  };

  const installPersona = async (persona: typeof COMMUNITY_PERSONAS[0]) => {
    setInstalling(persona.name);
    try {
      await fetch('/api/agent-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: persona.name,
          type: persona.type,
          model: persona.model,
          description: persona.description,
          prompt: persona.prompt,
        }),
      });
      setInstalled(prev => new Set([...prev, persona.name]));
    } catch {
      // silent
    } finally {
      setInstalling(null);
    }
  };

  const filteredPersonas = COMMUNITY_PERSONAS.filter(p => {
    if (!personaSearch) return true;
    const q = personaSearch.toLowerCase();
    return p.name.includes(q) || p.description.toLowerCase().includes(q) || p.tags.some(t => t.includes(q));
  });

  const getInstallCmd = (server: McpServer): string | null => {
    const pkgs = server.packages;
    if (pkgs) {
      const npmPkg = Object.values(pkgs).find(p => p.registry_name === 'npm');
      if (npmPkg?.name) return `npx ${npmPkg.name}`;
      const pipPkg = Object.values(pkgs).find(p => p.registry_name === 'pypi');
      if (pipPkg?.name) return `uvx ${pipPkg.name}`;
    }
    // Fall back to remote URL if available
    const remote = server.remotes?.[0];
    if (remote?.url) return remote.url;
    return null;
  };

  // Fetch preview content from GitHub when a non-persona item is previewed
  useEffect(() => {
    if (!previewItem || previewItem.type === 'persona' || !previewItem.url) {
      setPreviewContent(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewContent(null);
    fetch(`/api/marketplace/preview?url=${encodeURIComponent(previewItem.url)}`)
      .then(r => r.json())
      .then(d => setPreviewContent(d.content || null))
      .catch(() => setPreviewContent(null))
      .finally(() => setPreviewLoading(false));
  }, [previewItem]);

  // Global search filtering
  const q = globalSearch.toLowerCase();
  const matchSkill = (s: CuratedSkill) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.category.includes(q);
  const matchPersona = (p: typeof COMMUNITY_PERSONAS[0]) => !q || p.name.includes(q) || p.description.toLowerCase().includes(q) || p.tags.some(t => t.includes(q));
  const matchMcpCurated = (m: CuratedMcp) => !q || m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q);
  const matchRepo = (r: CuratedRepo) => !q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || r.category.includes(q);

  const filteredSkills = OFFICIAL_SKILLS.filter(matchSkill);
  const filteredPersonas2 = COMMUNITY_PERSONAS.filter(matchPersona);
  const filteredMcpCurated = CURATED_MCP.filter(matchMcpCurated);
  const filteredRepos = CURATED_REPOS.filter(matchRepo);
  const totalResults = filteredSkills.length + filteredPersonas2.length + filteredMcpCurated.length + filteredRepos.length;

  // Featured items (shown on 'all' tab)
  const FEATURED = [
    { ...OFFICIAL_SKILLS.find(s => s.name === 'Frontend Design')!, _type: 'skill' },
    { ...OFFICIAL_SKILLS.find(s => s.name === 'Superpowers')!, _type: 'skill' },
    { ...CURATED_MCP.find(m => m.name === 'Tavily')!, _type: 'mcp' },
    { ...CURATED_MCP.find(m => m.name === 'Context7')!, _type: 'mcp' },
    { ...CURATED_REPOS.find(r => r.name === 'LangGraph')!, _type: 'repo' },
    { ...CURATED_REPOS.find(r => r.name === 'Dify')!, _type: 'repo' },
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <SubNav tabs={[
            { label: 'personas', href: '/configs', active: false },
            { label: 'skills', href: '/skills', active: false },
            { label: 'marketplace', href: '/marketplace', active: true },
          ]} />
          <h1 className="font-mono text-sm text-zinc-100">marketplace</h1>
        </div>
        <div className="flex items-center gap-2">
          <a href="https://github.com/anthropics/skills" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-zinc-600 hover:text-zinc-400 font-mono text-[10px] transition-colors">
            anthropic/skills <ExternalLink className="w-3 h-3" />
          </a>
          <a href="https://skillsmp.com" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-zinc-600 hover:text-zinc-400 font-mono text-[10px] transition-colors">
            80k+ community <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Global search + filters */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/20 space-y-2">
        <div className="relative max-w-lg">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
          <input
            type="text"
            value={globalSearch}
            onChange={e => { setGlobalSearch(e.target.value); if (e.target.value && activeSection !== 'mcp') setActiveSection('all'); }}
            placeholder="search skills, personas, MCP servers, repos..."
            className="w-full pl-10 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg font-mono text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700"
          />
          {globalSearch && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[9px] text-zinc-600">
              {totalResults} results
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {([
            { id: 'all' as const, label: 'all', count: OFFICIAL_SKILLS.length + COMMUNITY_PERSONAS.length + CURATED_MCP.length + CURATED_REPOS.length },
            { id: 'skills' as const, label: 'skills', count: filteredSkills.length },
            { id: 'personas' as const, label: 'personas', count: filteredPersonas2.length },
            { id: 'mcp-curated' as const, label: 'MCP servers', count: filteredMcpCurated.length },
            { id: 'mcp' as const, label: 'registry', count: mcpServers.length || 0 },
            { id: 'repos' as const, label: 'repos', count: filteredRepos.length },
          ] as const).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              className={`px-2.5 py-1 rounded-full font-mono text-[10px] transition-colors flex-shrink-0 ${
                activeSection === tab.id
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300 bg-zinc-800/30 hover:bg-zinc-800/60'
              }`}
            >
              {tab.label} <span className="text-zinc-600 ml-0.5">{tab.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Preview modal */}
      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPreviewItem(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-wider">{previewItem.type}</span>
                  <h2 className="font-mono text-lg text-zinc-100 mt-0.5">{previewItem.name}</h2>
                </div>
                <button onClick={() => setPreviewItem(null)} className="text-zinc-600 hover:text-zinc-300 font-mono text-lg leading-none">&times;</button>
              </div>
              <p className="font-mono text-xs text-zinc-400">{previewItem.description}</p>
              {previewItem.tags && previewItem.tags.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {previewItem.tags.map(t => (
                    <span key={t} className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${TAG_COLORS[t] || 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'}`}>{t}</span>
                  ))}
                </div>
              )}
              {previewItem.prompt && (
                <div className="space-y-1">
                  <span className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">system prompt</span>
                  <pre className="font-mono text-[11px] text-zinc-300 bg-zinc-800/50 rounded-lg p-3 whitespace-pre-wrap max-h-64 overflow-y-auto">{previewItem.prompt}</pre>
                </div>
              )}
              {previewItem.installCmd && (
                <div className="space-y-1">
                  <span className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">install</span>
                  <code className="block font-mono text-xs text-emerald-400 bg-zinc-800/50 rounded-lg p-3 select-all">{previewItem.installCmd}</code>
                </div>
              )}
              {/* Fetched README/SKILL.md content */}
              {previewLoading && (
                <div className="space-y-1">
                  <span className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">loading readme...</span>
                  <div className="h-32 bg-zinc-800/50 rounded-lg animate-pulse" />
                </div>
              )}
              {previewContent && !previewLoading && (
                <div className="space-y-1">
                  <span className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">
                    {previewItem.type === 'skill' ? 'skill.md' : 'readme'}
                  </span>
                  <pre className="font-mono text-[11px] text-zinc-300 bg-zinc-800/50 rounded-lg p-3 whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed">{previewContent}</pre>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                {previewItem.url && (
                  <a href={previewItem.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md font-mono text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors">
                    <ExternalLink className="w-3 h-3" /> view source
                  </a>
                )}
                {previewItem.type === 'persona' && (
                  <button
                    onClick={() => {
                      const p = COMMUNITY_PERSONAS.find(x => x.name === previewItem.name);
                      if (p) { installPersona(p); setPreviewItem(null); }
                    }}
                    disabled={installed.has(previewItem.name)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-mono text-xs transition-colors ${
                      installed.has(previewItem.name)
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-emerald-600 text-white hover:bg-emerald-500'
                    }`}
                  >
                    {installed.has(previewItem.name) ? <><Check className="w-3 h-3" /> installed</> : <><Download className="w-3 h-3" /> install persona</>}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Featured + All tab */}
        {(['all', 'skills', 'mcp-curated', 'repos'] as const).includes(activeSection as 'all') ? (
          <div className="p-4 space-y-6">
            {/* Featured row (only on 'all' tab without search) */}
            {activeSection === 'all' && !globalSearch && (
              <div className="space-y-2">
                <h2 className="font-mono text-xs text-zinc-500 uppercase tracking-wider flex items-center gap-1.5"><Star className="w-3 h-3 text-amber-500" /> featured</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                  {FEATURED.map((item, i) => (
                    <button
                      key={i}
                      onClick={() => setPreviewItem({ type: item._type, name: item.name, description: item.description, url: 'url' in item ? item.url : undefined, installCmd: 'installCmd' in item ? item.installCmd : undefined, stars: 'stars' in item ? item.stars : undefined })}
                      className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 hover:border-zinc-600 hover:bg-zinc-800/50 transition-all text-left group"
                    >
                      <span className="font-mono text-[8px] text-zinc-600 uppercase">{item._type}</span>
                      <h4 className="font-mono text-xs text-zinc-200 group-hover:text-white transition-colors mt-0.5 truncate">{item.name}</h4>
                      <p className="font-mono text-[9px] text-zinc-600 mt-1 line-clamp-2">{item.description.slice(0, 60)}...</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Skills section */}
            {(activeSection === 'all' || activeSection === 'skills') && filteredSkills.length > 0 && (
              <div className="space-y-3">
                {activeSection === 'all' && <h2 className="font-mono text-xs text-zinc-500 uppercase tracking-wider flex items-center gap-1.5"><BookOpen className="w-3 h-3" /> skills</h2>}
                {Object.entries(SKILL_CATEGORIES).map(([catKey, cat]) => {
                  const skills = filteredSkills.filter(s => s.category === catKey);
                  if (skills.length === 0) return null;
                  return (
                    <div key={catKey} className="space-y-1.5">
                      <h3 className={`font-mono text-[10px] uppercase tracking-wider ${cat.color}`}>{cat.label}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                        {skills.map(skill => (
                          <button
                            key={skill.name}
                            onClick={() => setPreviewItem({ type: 'skill', name: skill.name, description: skill.description, url: skill.url, category: skill.category })}
                            className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 hover:border-zinc-700 transition-colors group text-left"
                          >
                            <h4 className="font-mono text-sm text-zinc-200 group-hover:text-white transition-colors">{skill.name}</h4>
                            <p className="font-mono text-[10px] text-zinc-500 mt-1 line-clamp-2">{skill.description}</p>
                            {skill.installs && (
                              <span className="inline-block mt-2 font-mono text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                {skill.installs} installs
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* MCP Curated section */}
            {(activeSection === 'all' || activeSection === 'mcp-curated') && filteredMcpCurated.length > 0 && (
              <div className="space-y-2">
                {activeSection === 'all' && <h2 className="font-mono text-xs text-zinc-500 uppercase tracking-wider flex items-center gap-1.5"><Server className="w-3 h-3" /> top MCP servers</h2>}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {filteredMcpCurated.map(server => (
                    <button
                      key={server.name}
                      onClick={() => setPreviewItem({ type: 'mcp', name: server.name, description: server.description, url: server.url, installCmd: server.installCmd })}
                      className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 hover:border-zinc-700 transition-colors text-left group"
                    >
                      <div className="flex items-center gap-2">
                        <Star className="w-3 h-3 text-amber-500 flex-shrink-0" />
                        <h4 className="font-mono text-sm text-zinc-200 group-hover:text-white transition-colors">{server.name}</h4>
                      </div>
                      <p className="font-mono text-[10px] text-zinc-500 mt-1 ml-5 line-clamp-2">{server.description}</p>
                      {server.installCmd && (
                        <code className="block mt-2 ml-5 font-mono text-[9px] text-zinc-500 bg-zinc-800/40 px-2 py-0.5 rounded truncate">{server.installCmd}</code>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Repos section */}
            {(activeSection === 'all' || activeSection === 'repos') && filteredRepos.length > 0 && (
              <div className="space-y-3">
                {activeSection === 'all' && <h2 className="font-mono text-xs text-zinc-500 uppercase tracking-wider flex items-center gap-1.5"><GitBranch className="w-3 h-3" /> repos</h2>}
                {Object.entries(REPO_CATEGORIES).map(([catKey, cat]) => {
                  const repos = filteredRepos.filter(r => r.category === catKey);
                  if (repos.length === 0) return null;
                  const CatIcon = cat.icon;
                  return (
                    <div key={catKey} className="space-y-1.5">
                      <h3 className="font-mono text-[10px] text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                        <CatIcon className="w-3 h-3" /> {cat.label}
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                        {repos.map(repo => (
                          <button
                            key={repo.name}
                            onClick={() => setPreviewItem({ type: 'repo', name: repo.name, description: repo.description, url: repo.url, stars: repo.stars })}
                            className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 hover:border-zinc-700 transition-colors group text-left flex items-start justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <h4 className="font-mono text-sm text-zinc-200 group-hover:text-white transition-colors">{repo.name}</h4>
                              <p className="font-mono text-[10px] text-zinc-500 mt-1">{repo.description}</p>
                            </div>
                            {repo.stars && (
                              <span className="font-mono text-[9px] text-amber-400 flex items-center gap-0.5 flex-shrink-0">
                                <Star className="w-2.5 h-2.5" /> {repo.stars}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* No results */}
            {globalSearch && totalResults === 0 && (
              <div className="text-center py-16">
                <Search className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
                <p className="font-mono text-xs text-zinc-600">nothing matches &ldquo;{globalSearch}&rdquo;</p>
              </div>
            )}
          </div>
        ) : activeSection === 'personas' ? (
          <div className="p-4 space-y-4">
            {/* Persona grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {(globalSearch ? filteredPersonas2 : COMMUNITY_PERSONAS).map(p => {
                const isInstalled = installed.has(p.name);
                const isInstalling = installing === p.name;
                return (
                  <div
                    key={p.name}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col gap-3 hover:border-zinc-700 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-mono text-sm text-zinc-200 truncate">{p.name}</h3>
                        <p className="font-mono text-[11px] text-zinc-500 mt-1 line-clamp-2">{p.description}</p>
                      </div>
                      <button
                        onClick={() => !isInstalled && installPersona(p)}
                        disabled={isInstalled || isInstalling}
                        className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md font-mono text-[10px] transition-colors ${
                          isInstalled
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-default'
                            : isInstalling
                            ? 'bg-zinc-800 text-zinc-500 cursor-wait'
                            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'
                        }`}
                      >
                        {isInstalled ? (
                          <><Check className="w-3 h-3" /> installed</>
                        ) : isInstalling ? (
                          <><RefreshCw className="w-3 h-3 animate-spin" /> adding...</>
                        ) : (
                          <><Download className="w-3 h-3" /> install</>
                        )}
                      </button>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        {p.type}
                      </span>
                      <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                        {p.model}
                      </span>
                      {p.tags.map(t => (
                        <span
                          key={t}
                          className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${TAG_COLORS[t] || 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'}`}
                        >
                          {t}
                        </span>
                      ))}
                    </div>

                    <div className="mt-auto flex items-center justify-between">
                      <p className="font-mono text-[10px] text-zinc-600 line-clamp-1 flex-1">{p.prompt.slice(0, 80)}...</p>
                      <button
                        onClick={(e) => { e.stopPropagation(); setPreviewItem({ type: 'persona', name: p.name, description: p.description, prompt: p.prompt, tags: p.tags }); }}
                        className="font-mono text-[9px] text-zinc-600 hover:text-zinc-300 flex-shrink-0 ml-2 transition-colors"
                      >
                        preview
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {globalSearch && filteredPersonas2.length === 0 && (
              <div className="text-center py-12">
                <Package className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
                <p className="font-mono text-xs text-zinc-600">no personas match &ldquo;{globalSearch}&rdquo;</p>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {/* MCP Search */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                <input
                  type="text"
                  value={mcpSearch}
                  onChange={e => handleMcpSearch(e.target.value)}
                  placeholder="search MCP servers..."
                  className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-md font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:border-zinc-600"
                />
              </div>
              <button
                onClick={() => fetchMcp(mcpSearch)}
                className="text-zinc-600 hover:text-zinc-400 transition-colors"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${mcpLoading ? 'animate-spin' : ''}`} />
              </button>
              <a
                href="https://registry.modelcontextprotocol.io"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-zinc-600 hover:text-zinc-400 font-mono text-[10px] transition-colors"
              >
                registry <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {mcpError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 font-mono text-xs text-red-400">
                {mcpError}
              </div>
            )}

            {/* MCP Server list */}
            {mcpLoading && mcpServers.length === 0 ? (
              <div className="space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-20 bg-zinc-900 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {mcpServers.map((server, i) => {
                  const cmd = getInstallCmd(server);
                  const repoUrl = server.repository?.url;
                  return (
                    <div
                      key={`${server.name}-${i}`}
                      className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 hover:border-zinc-700 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Server className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                            <h3 className="font-mono text-sm text-zinc-200 truncate">{server.name}</h3>
                          </div>
                          {server.description && (
                            <p className="font-mono text-[11px] text-zinc-500 mt-1.5 line-clamp-2 ml-5">
                              {server.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {repoUrl && (
                            <a
                              href={repoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 px-2 py-1 rounded-md font-mono text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                            >
                              repo <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                      {cmd && (
                        <div className="mt-2 ml-5">
                          <code className="font-mono text-[10px] text-zinc-400 bg-zinc-800/50 px-2 py-1 rounded select-all">
                            {cmd}
                          </code>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Load more */}
            {mcpCursor && !mcpLoading && (
              <div className="flex justify-center py-4">
                <button
                  onClick={() => fetchMcp(mcpSearch, mcpCursor)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-md font-mono text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                >
                  load more <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {mcpLoading && mcpServers.length > 0 && (
              <div className="flex justify-center py-4">
                <RefreshCw className="w-4 h-4 text-zinc-600 animate-spin" />
              </div>
            )}

            {!mcpLoading && mcpServers.length === 0 && !mcpError && (
              <div className="text-center py-12">
                <Server className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
                <p className="font-mono text-xs text-zinc-600">
                  {mcpSearch ? `no servers match "${mcpSearch}"` : 'no MCP servers found'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
