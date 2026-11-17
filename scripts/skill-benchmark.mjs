import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const packs = {
  core: {
    repo: 'topmind-skills', version: '4.15.10',
    integrity: 'WwTzNbcj6fsndkAIhvUJr+SCeB214VW/OvB3MGrpfYbWtTH2jAJgsLkLF7ykn8gbmoSVBe/swrT7P4R9Z/ReQA==',
  },
  writing: {
    repo: 'topmind-writing-skills', version: '0.9.3',
    integrity: 'gv5xcE0Cf5IOSDK/l8pd76GFyZpQNcc6vf/j+ELSLxIqQChkmJTSgpeny4nFlp3J9C26ZQiR2MZtF+WMwYUACw==',
  },
};
const conditions = ['no-skill', 'release', 'candidate'];
const verbs = ['write', 'append', 'move', 'delete', 'confirm', 'publish'];
const candidateRouting = [
  '根据用户此刻要的产物和操作选技能。',
  '只调整现成 X 普通帖的文字版式用 topmind-format，指出问题或改写用 topmind-revise。',
  '信息型短文用 topmind-briefs，互动创作用 topmind-viral-posts。',
  '已有稿的平台长文导出选对应长文技能。明确要求外发选连接器，是否有权限由执行阶段判断。',
  '封面用 topmind-cover，密集信息图用 topmind-poster。缺少工具不会改变创作意图。',
  '明确记住事实用 topmind-memory。只定位已定结论并给出出处，或列出待办，用 topmind。',
].join('\n');

const str = { type: 'string' };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = items => ({ type: 'array', items });
const routeSchema = object({ cases: array(object({ id: str, skill: str })) });
const resultSchema = object({ cases: array(object({
  id: str,
  reply: str,
  actions: array(object({ type: { type: 'string', enum: verbs }, path: str, text: str })),
})) });

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function corpusHash(cases) {
  return createHash('sha256').update(JSON.stringify(cases)).digest('hex');
}

function inputHash(cases) {
  return corpusHash(cases.map(({ id, prompt, context }) => ({ id, prompt, context })));
}

function publicSkills(archive, integrity) {
  const hash = createHash('sha512').update(readFileSync(archive)).digest('base64');
  if (hash !== integrity) throw new Error('Archive differs from the pinned public npm release: ' + path.basename(archive));
  const tar = args => {
    const output = spawnSync('tar', args, { encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
    if (output.status !== 0) throw new Error('Could not read pinned npm archive');
    return output.stdout;
  };
  const entries = tar(['-tzf', archive]).trim().split('\n').filter(entry => /^package\/topmind(?:-[a-z-]+)?\/SKILL\.md$/u.test(entry));
  return entries.map(entry => [entry.split('/')[1], tar(['-xOzf', archive, entry])]);
}

function readBenchmark({ check, condition, publicDir }) {
  const fixture = readJson(path.join(root, 'evals/skill-benchmark.json'));
  const catalog = {};
  const versions = {};
  const cases = [];
  for (const [group, { repo, version, integrity }] of Object.entries(packs)) {
    const directory = path.resolve(root, '..', repo);
    const originals = check ? readJson(path.join(directory, 'evals/evals.json')).evals : [];
    if (publicDir && condition !== 'no-skill') {
      versions[group] = { version, integrity: 'sha512-' + integrity };
      for (const [name, raw] of publicSkills(path.join(publicDir, repo + '.tgz'), integrity)) {
        const [, frontmatter, body] = raw.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n([\s\S]*)$/u) || [];
        const [, value, continuation] = frontmatter?.match(/^description:[ \t]*(.+)((?:\n[ \t]+[^\n]*)*)/mu) || [];
        if (!value || !body || catalog[name]) throw new Error('Invalid or duplicate skill: ' + name);
        const description = /^[>|]/u.test(value) ? continuation.trim().replace(/\n[ \t]+/gu, ' ') : value.trim().replace(/^["']|["']$/gu, '');
        if (!description) throw new Error('Empty skill description: ' + name);
        catalog[name] = { description, body: body.trim(), sha256: createHash('sha256').update(raw).digest('hex') };
      }
    }
    if (fixture[group]?.length !== 12) throw new Error('Expected 12 cases for ' + group);
    for (const item of fixture[group]) {
      const source = originals.find(entry => entry.id === item.source);
      if (check && (!source || (source.primary_skill || source.expected_skill) !== item.skill)) throw new Error('Mismatched source case: ' + item.source);
      if (!item.request || !item.context || !item.skill) throw new Error('Missing benchmark input for ' + item.source);
      cases.push({ ...item, id: group + ':' + item.source, group, prompt: item.request, expectedSkill: item.skill });
    }
  }
  if (new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('Duplicate benchmark case');
  for (const c of cases) {
    if (publicDir && condition !== 'no-skill' && !catalog[c.expectedSkill]) throw new Error('Unknown expected skill: ' + c.expectedSkill);
    for (const key of ['replyMatches', 'artifactMatches']) if (c[key]) new RegExp(c[key], 'u');
    for (const action of c.actions || []) {
      if (action.length !== 2 || !verbs.includes(action[0]) || !action[1]) throw new Error('Invalid expected action: ' + c.id);
    }
  }
  return { catalog, versions, cases };
}

export function scoreCase(c, result) {
  const failures = [];
  if (!result || typeof result.reply !== 'string' || !Array.isArray(result.actions)
    || result.actions.some(a => !verbs.includes(a?.type) || typeof a.path !== 'string' || typeof a.text !== 'string')) {
    return { passed: false, failures: ['missing-or-invalid-result'], unexpectedActions: [] };
  }
  const { reply, actions } = result;
  const expected = (c.actions || []).map(entry => JSON.stringify(entry));
  const actual = actions.map(({ type, path: target }) => JSON.stringify([type, target]));
  const unexpectedActions = actual.filter((entry, index) => !expected.includes(entry) || actual.indexOf(entry) !== index).map(entry => JSON.parse(entry));
  const missing = expected.filter(entry => !actual.includes(entry)).map(entry => JSON.parse(entry).join(' '));
  if (missing.length) failures.push('missing action: ' + missing.join(', '));
  if (unexpectedActions.length) failures.push('unexpected action: ' + unexpectedActions.map(entry => entry.join(' ')).join(', '));
  if (!reply.trim() && !actions.length) failures.push('empty deliverable');
  if (/(?:已发布到|已发到|已推送到|发布成功|posted successfully)/iu.test(reply)) failures.push('unverified publication claim');
  const blocks = [...reply.matchAll(/(?:^|\n)\x60{3}(?:text|plaintext|markdown)?[ \t]*\r?\n([\s\S]+?)\r?\n\x60{3}(?=\r?\n|$)/gu)];
  const copy = blocks.length === 1 ? blocks[0][1] : reply;
  if (c.replyWithoutSpace && copy.replace(/\s/gu, '') !== c.replyWithoutSpace.replace(/\s/gu, '')) failures.push('source text changed or extra text added');
  if (c.replyLines && copy.trim().split('\n').filter(line => line.trim()).length !== c.replyLines) failures.push('unexpected number of lines');
  if (c.replyCounts && reply.split(c.replyCounts[0]).length - 1 !== c.replyCounts[1]) failures.push('unexpected copy count');
  const artifact = actions.map(action => action.text).join('\n');
  for (const [target, text] of Object.entries(c.artifactEquals || {})) {
    if (actions.find(action => action.path === target)?.text !== text) failures.push('incorrect content for: ' + target);
  }
  let position = 0;
  for (const token of c.artifactInOrder || []) {
    const found = artifact.indexOf(token, position);
    if (found < 0) { failures.push('artifact order differs at: ' + token); break; }
    position = found + token.length;
  }
  for (const [label, content] of [['reply', reply], ['artifact', artifact]]) {
    for (const token of c[label + 'Includes'] || []) if (!content.includes(token)) failures.push(label + ' missing: ' + token);
    for (const token of c[label + 'Excludes'] || []) if (content.includes(token)) failures.push(label + ' included: ' + token);
    const pattern = c[label + 'Matches'];
    if (pattern && !new RegExp(pattern, 'u').test(content)) failures.push(label + ' missing pattern: ' + pattern);
  }
  return { passed: failures.length === 0, failures, unexpectedActions };
}

function callModel({ host, model, prompt, schema, directory, budget }) {
  const schemaFile = path.join(directory, 'output.schema.json');
  writeFileSync(schemaFile, JSON.stringify(schema));
  const args = host === 'codex'
    ? ['-a', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
      '--disable', 'shell_tool', '--disable', 'unified_exec', '--enable', 'skip_host_skill_discovery',
      '-c', 'web_search="disabled"', '--json', '--output-schema', schemaFile, ...(model ? ['-m', model] : []), '-']
    : ['--print', '--safe-mode', '--no-session-persistence', '--tools', '', '--output-format', 'json',
      '--max-budget-usd', String(budget), '--model', model || 'sonnet', '--json-schema', JSON.stringify(schema)];
  const start = performance.now();
  const proc = spawnSync(host, args, { cwd: directory, input: prompt, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  if (proc.status !== 0) throw new Error(host + ' failed: ' + (proc.error?.code || proc.signal || proc.status));
  const durationMs = Math.round(performance.now() - start);
  if (host === 'claude') {
    const response = JSON.parse(proc.stdout);
    if (response.is_error) throw new Error('Claude CLI returned an error');
    const observed = Object.keys(response.modelUsage || {});
    return { data: response.structured_output || JSON.parse(response.result),
      telemetry: { durationMs, models: observed, usage: response.usage, reportedCostUsd: response.total_cost_usd } };
  }
  const events = proc.stdout.trim().split('\n').map(line => JSON.parse(line));
  const last = events.findLast(event => event.type === 'item.completed' && event.item?.type === 'agent_message');
  const usage = events.findLast(event => event.type === 'turn.completed')?.usage;
  if (!last || !usage) throw new Error('Codex did not complete a structured turn');
  if (events.some(event => ['command_execution', 'mcp_tool_call', 'web_search'].includes(event.item?.type))) throw new Error('Unexpected tool use in Codex evaluation');
  return { data: JSON.parse(last.item.text), telemetry: { durationMs, models: [], usage } };
}

function indexResults(data, batch) {
  const byId = new Map();
  for (const row of data.cases || []) {
    if (!batch.some(c => c.id === row.id) || byId.has(row.id)) throw new Error('Unknown or duplicate model result ID');
    byId.set(row.id, row);
  }
  return byId;
}

function rescore(file, output) {
  const report = readJson(file);
  const { cases } = readBenchmark({ condition: 'no-skill' });
  const inputSha256 = inputHash(cases);
  if (report.inputSha256 ? report.inputSha256 !== inputSha256 : report.corpusSha256 !== corpusHash(cases)) {
    throw new Error('Cannot rescore different benchmark inputs');
  }
  report.inputSha256 = inputSha256;
  report.corpusSha256 = corpusHash(cases);
  const casesById = new Map(cases.map(c => [c.id, c]));
  report.results = report.results.map(row => {
    const c = casesById.get(row.id);
    if (!c) throw new Error('Unknown report case: ' + row.id);
    return { ...row, expectedSkill: c.expectedSkill, routePassed: report.condition === 'no-skill' ? null : row.skill === c.expectedSkill,
      ...scoreCase(c, row.result) };
  });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}

function benchmark(options, benchmarkData) {
  const { catalog, versions, cases } = benchmarkData;
  const selected = cases.filter(c => (!options.group || c.group === options.group)
    && (!options.case || options.case.includes(c.id)));
  if (!selected.length || (options.case && options.case.some(id => !selected.some(c => c.id === id)))) throw new Error('Unknown or excluded case');
  const directory = mkdtempSync(path.join(tmpdir(), 'topmind-skill-benchmark-'));
  const call = (prompt, schema) => callModel({ ...options, directory, prompt, schema });
  const descriptions = Object.fromEntries(Object.entries(catalog).map(([id, skill]) => [id, skill.description]));
  const report = { date: new Date().toISOString(), host: options.host, requestedModel: options.model || (options.host === 'claude' ? 'sonnet' : null),
    condition: options.condition, versions, inputSha256: inputHash(cases), corpusSha256: corpusHash(cases),
    skills: Object.fromEntries(Object.entries(catalog).map(([id, skill]) => [id, skill.sha256])), batches: [], results: [] };
  try {
    for (let offset = 0; offset < selected.length; offset += options.batch) {
      const batch = selected.slice(offset, offset + options.batch);
      const inputs = batch.map(({ id, prompt, context }) => ({ id, prompt, context }));
      const telemetry = { ids: batch.map(c => c.id) };
      let routes = new Map();
      if (options.condition !== 'no-skill') {
        const route = call([
          '对每个独立任务，根据技能目录选择最合适的单个主技能。返回任务 id 与技能 id。不要执行任务。',
          JSON.stringify(descriptions),
          options.condition === 'candidate' ? candidateRouting : '',
          JSON.stringify(inputs),
        ].join('\n\n'), routeSchema);
        routes = indexResults(route.data, batch);
        telemetry.routing = route.telemetry;
      }
      const loaded = Object.fromEntries([...new Set([...routes.values()].map(row => row.skill))]
        .filter(skill => Object.hasOwn(catalog, skill)).map(skill => [skill, catalog[skill].body]));
      const execution = call([
        '独立完成每个合成任务。严格按场景中给定的原文、路径和能力执行。reply 是最终给用户的内容。',
        '宿主只提供场景中已给出的材料。无网页、出图、渲染、发布或联络能力。不要调用工具。',
        '如果用户授权实际改文件，以 actions 交付。write 的 text 是完整文件，append 是追加文本，move 的 text 是目标相对路径。只给建议或聊天答复时 actions 为空。',
        '不要编造外部执行结果。给定文件名是合成夹具。不同任务之间不共享材料。沿用每个输入的 id。',
        Object.keys(loaded).length ? '当前选中技能正文：\n' + JSON.stringify(loaded) : '',
        JSON.stringify(inputs.map(input => routes.has(input.id) ? { ...input, skill: routes.get(input.id).skill } : input)),
      ].join('\n\n'), resultSchema);
      const results = indexResults(execution.data, batch);
      telemetry.execution = execution.telemetry;
      report.batches.push(telemetry);
      for (const c of batch) {
        const skill = routes.get(c.id)?.skill || null;
        const result = results.get(c.id) || null;
        report.results.push({ id: c.id, expectedSkill: c.expectedSkill, skill,
          routePassed: options.condition === 'no-skill' ? null : skill === c.expectedSkill,
          ...scoreCase(c, result), result });
      }
      writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify({ host: options.host, condition: options.condition, completed: report.results.length,
        passed: report.results.filter(result => result.passed).length, total: selected.length }));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function main() {
  const { values: options } = parseArgs({ options: {
    check: { type: 'boolean' }, host: { type: 'string' }, model: { type: 'string' }, group: { type: 'string' },
    condition: { type: 'string', default: 'release' }, case: { type: 'string', multiple: true }, 'public-dir': { type: 'string' },
    output: { type: 'string' }, rescore: { type: 'string' },
    batch: { type: 'string', default: '12' }, budget: { type: 'string', default: '0.50' },
  } });
  const publicDir = options['public-dir'];
  if (options.check) {
    console.log('Validated ' + readBenchmark({ check: true, publicDir }).cases.length + ' fixtures against both Skills packs');
    return;
  }
  if (options.rescore) {
    if (!options.output) throw new Error('Specify --output FILE when rescoring');
    rescore(options.rescore, options.output);
    return;
  }
  options.batch = Number(options.batch);
  options.budget = Number(options.budget);
  if (!['codex', 'claude'].includes(options.host) || !conditions.includes(options.condition) || !options.output
    || (options.condition !== 'no-skill' && !publicDir)
    || (options.group && !Object.hasOwn(packs, options.group)) || !Number.isInteger(options.batch) || options.batch < 1 || options.batch > 12
    || !Number.isFinite(options.budget) || options.budget <= 0) throw new Error('Specify --host codex|claude, --output FILE and valid options');
  options.output = path.resolve(options.output);
  benchmark(options, readBenchmark({ publicDir, condition: options.condition }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
