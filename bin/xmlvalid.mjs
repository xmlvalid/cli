#!/usr/bin/env node
// xmlvalid command-line client: validates XML files through the xmlvalid.com API.
// No dependencies; Node 20 or newer. See README.md.

import { openAsBlob } from 'node:fs';
import { readdir, readFile, stat, appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { fromApi, reportHtml } from './report.mjs';

export const VERSION = '1.2.0';

const DEFAULT_API = 'https://xmlvalid.com/api/v1';

const EXIT = { ok: 0, invalid: 1, usage: 2, failure: 3 };

const HELP = `xmlvalid ${VERSION}: validate XML with the xmlvalid.com API

Usage:
  xmlvalid validate <file|glob>... [options]
  xmlvalid validate --url <address> [options]
  xmlvalid schemas          list catalog and saved schemas
  xmlvalid usage            this month's API validations

Options for validate:
  -s, --schema <name>       a catalog slug (atom-1.0), saved schema (my-12), or
                            auto for the profile each e-invoice names
      --schema-file <path>  an XSD, DTD or RelaxNG file sent with each document
      --doctype             validate against each document's own DOCTYPE
      --rules <path>        your own Schematron (.sch) rules, run after the schema;
                            files it includes are sent along
      --rules-version <set@version>
                            fail (exit 2) unless a catalog rule set runs this
                            release, such as peppol-bis-3-ubl@3.0.21 (repeatable)
      --url <address>       validate a document at a public URL (repeatable)
  -f, --format <format>     text (default), json or github
      --fail-on-warnings    exit 1 when a document has warnings
      --report <file.html>  also write an HTML report of every document, with
                            links to each rule (open it and save it as PDF)
      --share               also make a public link to that report, open for
                            30 days (Pro)
  -j, --concurrency <n>     documents validated at once (default 4)
      --max-errors <n>      errors printed per document (default 20)

Global options:
      --api-key <key>       defaults to $XMLVALID_API_KEY
      --api-url <url>       defaults to $XMLVALID_API_URL or ${DEFAULT_API}
  -h, --help
  -v, --version

Exit codes: 0 all valid, 1 a document is invalid, 2 usage, schema or quota
problem, 3 network or server error.`;

class CliError extends Error {
    constructor(message, code = EXIT.usage) {
        super(message);
        this.code = code;
    }
}

/** Parses argv into { command, args, options }. */
export function parseArgs(argv) {
    const options = { url: [], rulesVersion: [], format: 'text', concurrency: 4, maxErrors: 20 };
    const args = [];
    const takes = {
        '-s': 'schema', '--schema': 'schema',
        '--schema-file': 'schemaFile',
        '--rules': 'rules',
        '--rules-version': 'rulesVersion',
        '--url': 'url',
        '-f': 'format', '--format': 'format',
        '-j': 'concurrency', '--concurrency': 'concurrency',
        '--max-errors': 'maxErrors',
        '--report': 'report',
        '--api-key': 'apiKey',
        '--api-url': 'apiUrl',
    };
    const flags = {
        '--doctype': 'doctype',
        '--fail-on-warnings': 'failOnWarnings',
        '--share': 'share',
        '-h': 'help', '--help': 'help',
        '-v': 'version', '--version': 'version',
    };

    for (let i = 0; i < argv.length; i++) {
        let arg = argv[i];
        let value;
        if (arg.startsWith('--') && arg.includes('=')) {
            [arg, value] = [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)];
        }

        if (flags[arg]) {
            options[flags[arg]] = true;
        } else if (takes[arg]) {
            value ??= argv[++i];
            if (value === undefined) {
                throw new CliError(`${arg} needs a value.`);
            }
            const key = takes[arg];
            if (key === 'url' || key === 'rulesVersion') {
                options[key].push(value);
            } else if (key === 'concurrency' || key === 'maxErrors') {
                options[key] = Number.parseInt(value, 10);
                if (!Number.isInteger(options[key]) || options[key] < (key === 'maxErrors' ? 0 : 1)) {
                    throw new CliError(`${arg} must be a whole number.`);
                }
            } else {
                options[key] = value;
            }
        } else if (arg.startsWith('-') && arg !== '-') {
            throw new CliError(`Unknown option ${arg}. See xmlvalid --help.`);
        } else {
            args.push(arg);
        }
    }

    return { command: args.shift(), args, options };
}

/** A glob as a regular expression over "/"-separated relative paths. */
function globToRegExp(glob) {
    let source = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
            // "**/" matches any number of directories, including none.
            source += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
            i += glob[i + 2] === '/' ? 2 : 1;
        } else if (c === '*') {
            source += '[^/]*';
        } else if (c === '?') {
            source += '[^/]';
        } else if (c === '{') {
            const end = glob.indexOf('}', i);
            if (end === -1) {
                source += '\\{';
            } else {
                source += '(?:' + glob.slice(i + 1, end).split(',').map((p) => p.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|') + ')';
                i = end;
            }
        } else {
            source += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
        }
    }

    return new RegExp('^' + source + '$');
}

async function walk(directory, prefix, found) {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') {
            continue;
        }
        const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) {
            await walk(path.join(directory, entry.name), relative, found);
        } else if (entry.isFile()) {
            found.push(relative);
        }
    }
}

/** Expands files and globs (*, **, ?, {a,b}) relative to `cwd`, in a stable order. */
export async function expandFiles(patterns, cwd = process.cwd()) {
    const files = new Set();

    for (const pattern of patterns) {
        const normal = pattern.split(path.sep).join('/').replace(/^\.\//, '');
        if (!/[*?{]/.test(normal)) {
            const info = await stat(path.resolve(cwd, normal)).catch(() => null);
            if (info?.isFile()) {
                files.add(normal);
                continue;
            }
            throw new CliError(`No such file: ${pattern}`);
        }

        // Walk only below the part of the pattern without wildcards.
        const parts = normal.split('/');
        const fixed = [];
        while (parts.length > 1 && !/[*?{]/.test(parts[0])) {
            fixed.push(parts.shift());
        }
        const base = fixed.join('/');
        const matcher = globToRegExp(parts.join('/'));
        const found = [];
        await walk(path.resolve(cwd, base || '.'), '', found);

        const matches = found.filter((file) => matcher.test(file)).map((file) => (base ? `${base}/${file}` : file));
        if (matches.length === 0) {
            throw new CliError(`Nothing matches ${pattern}`);
        }
        matches.sort().forEach((file) => files.add(file));
    }

    return [...files];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A Schematron file and the files it includes (sch:include, sch:extends,
 * xsl:include, xsl:import), found by their href attributes, recursively.
 * Paths are relative to the folder all of them share, main first.
 *
 * @returns {Promise<{ path: string, file: string }[]>}  path: sent to the API; file: on disk
 */
export async function collectRules(main) {
    const seen = new Map();
    const queue = [path.resolve(main)];
    while (queue.length) {
        const file = queue.shift();
        if (seen.has(file)) continue;
        let text;
        try {
            text = await readFile(file, 'utf8');
        } catch {
            throw new CliError(seen.size === 0 ? `No such file: ${main}` : `${path.relative(process.cwd(), [...seen.keys()].at(-1))} includes ${path.relative(process.cwd(), file)}, which does not exist.`);
        }
        seen.set(file, true);
        const tags = /<(?:[\w.-]+:)?(?:include|extends|import)\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1/g;
        for (const [, , href] of text.matchAll(tags)) {
            const target = href.replace(/#.*$/, '');
            if (target === '' || /^[a-z][a-z0-9+.-]*:|^\//i.test(target)) continue;
            queue.push(path.resolve(path.dirname(file), target));
        }
    }

    const files = [...seen.keys()];
    let base = path.dirname(files[0]);
    while (!files.every((file) => file.startsWith(base + path.sep))) base = path.dirname(base);

    return files.map((file) => ({ path: path.relative(base, file).split(path.sep).join('/'), file }));
}

/** A small API client over fetch. */
export class Api {
    constructor({ key, base, userAgent = `xmlvalid-cli/${VERSION}`, fetchImpl = globalThis.fetch }) {
        this.key = key;
        this.base = base.replace(/\/+$/, '');
        this.userAgent = userAgent;
        this.fetch = fetchImpl;
    }

    async request(method, url, body, attempt = 0) {
        let response;
        try {
            // A plain object goes as JSON; FormData sets its own type.
        const json = body !== undefined && !(body instanceof FormData);
        response = await this.fetch(url.startsWith('http') ? url : this.base + url, {
                method,
                body: json ? JSON.stringify(body) : body,
                headers: { Authorization: `Bearer ${this.key}`, Accept: 'application/json', 'User-Agent': this.userAgent, ...(json ? { 'Content-Type': 'application/json' } : {}) },
            });
        } catch (error) {
            throw new CliError(`Could not reach ${this.base}: ${error.cause?.message ?? error.message}`, EXIT.failure);
        }

        const text = await response.text();
        let json = null;
        try {
            json = text === '' ? null : JSON.parse(text);
        } catch {
            // Not JSON: reported below.
        }

        if (response.status === 429 && json?.error?.code === 'rate_limited' && attempt < 5) {
            const wait = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
            await sleep((Number.isFinite(wait) ? wait : 2 ** attempt) * 1000);

            return this.request(method, url, body, attempt + 1);
        }

        if (!response.ok) {
            const message = json?.error?.message ?? `HTTP ${response.status}`;
            const code = json?.error?.code;
            const fatal = ['unauthenticated', 'quota_exceeded', 'unknown_schema', 'invalid_schema', 'invalid_rules', 'too_large', 'invalid_request', 'invalid_url', 'missing_document', 'rules_version_mismatch'];
            throw new CliError(message, code && fatal.includes(code) ? EXIT.usage : EXIT.failure);
        }

        return { status: response.status, json, location: response.headers.get('location') };
    }

    /** Sends one document and waits for the finished validation. */
    async validate({ file, url, schema, schemaFile, doctype, rules, rulesVersion }, { pollEvery = 2000, timeout = 20 * 60_000 } = {}) {
        const form = new FormData();
        if (file) {
            form.append('document', await openAsBlob(file), path.basename(file));
        } else {
            form.append('url', url);
        }
        if (schema) form.append('schema', schema);
        if (schemaFile) form.append('schema_file', await openAsBlob(schemaFile), path.basename(schemaFile));
        if (doctype) form.append('doctype', '1');
        for (const rule of rules ?? []) {
            form.append('rules_file[]', await openAsBlob(rule.file), path.basename(rule.file));
            form.append('rules_path[]', rule.path);
        }
        for (const pin of rulesVersion ?? []) form.append('rules_version[]', pin);
        form.append('wait', '30');

        let { json, location } = await this.request('POST', '/validations', form);
        const deadline = Date.now() + timeout;

        while (json.status === 'queued' || json.status === 'running') {
            if (Date.now() > deadline) {
                throw new CliError(`Gave up waiting for ${json.id}.`, EXIT.failure);
            }
            await sleep(pollEvery);
            ({ json } = await this.request('GET', location ?? json.links.self));
        }

        return json;
    }
}

/** Runs `worker` over `items` with at most `limit` at once, keeping the order. */
async function pool(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await worker(items[index], index);
        }
    });
    await Promise.all(lanes);

    return results;
}

const plural = (n = 0, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** "valid", "3 errors", "schema error"… */
export function describe(validation) {
    const result = validation.result;
    if (validation.status === 'cancelled') return 'cancelled';
    if (!result) return validation.error ?? 'failed';
    if (result.documents) {
        const { total, failed, skipped } = result.documents;

        return [plural(total, 'document'), failed > 0 ? `${failed.toLocaleString('en-US')} failed` : null, skipped > 0 ? `${skipped.toLocaleString('en-US')} skipped` : null, result.outcome === 'schema' ? 'schema error' : null].filter(Boolean).join(', ');
    }

    return {
        valid: 'valid',
        warnings: `valid, ${plural(result.warnings_total, 'warning')}`,
        invalid: plural(result.errors_total, 'error'),
        schema: 'schema error',
        input: 'could not be read',
        failed: 'failed',
        skipped: `skipped: ${result.note ?? 'not checked'}`,
    }[result.outcome] ?? result.outcome;
}

/** Whether a finished validation passes, given --fail-on-warnings. */
export function passes(validation, failOnWarnings = false) {
    const outcome = validation.result?.outcome;

    return outcome === 'valid' || (outcome === 'warnings' && !failOnWarnings);
}

// GitHub workflow commands: https://docs.github.com/actions/reference/workflow-commands-for-github-actions
const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** The lines printed for one document; for a .zip or .epub, a line for it and its documents below. */
export function render(item, validation, options) {
    const { format, maxErrors, failOnWarnings } = options;
    const label = item.file ?? item.url ?? item.entry;
    const ok = passes(validation, failOnWarnings);
    const mark = validation.result?.outcome === 'skipped' ? '-' : ok ? '✓' : '✗';

    if (validation.result?.items) {
        const lines = [`${mark} ${label}  ${describe(validation)}`];
        for (const entry of validation.result.items) {
            // Annotations can't point inside an archive, so its documents carry no file.
            const nested = render({ entry: `${label}!${entry.name}` }, { status: 'done', result: entry }, options);
            lines.push(...(format === 'github' ? nested : nested.map((line) => `  ${line}`)));
        }

        return lines;
    }

    const diagnostics = [
        ...(validation.result?.errors ?? []).map((d) => ({ ...d, kind: 'error' })),
        ...(validation.result?.warnings ?? []).map((d) => ({ ...d, kind: 'warning' })),
    ];
    const lines = [];

    if (format === 'github') {
        for (const d of diagnostics.slice(0, Math.max(maxErrors, 1) * 2)) {
            const props = [item.file ? `file=${escapeProperty(item.file)}` : null, d.line > 0 ? `line=${d.line}` : null, d.column > 0 ? `col=${d.column}` : null, `title=${escapeProperty('xmlvalid: ' + (item.file ? d.rule ?? d.type : label))}`]
                .filter(Boolean).join(',');
            lines.push(`::${d.kind} ${props}::${escapeData(d.message_en ? `${d.message} (${d.message_en})` : d.message)}`);
        }
        if (!validation.result) {
            lines.push(`::error${item.file ? ` file=${escapeProperty(item.file)}` : ''}::${escapeData(describe(validation))}`);
        }
    }

    lines.push(`${mark} ${label}  ${describe(validation)}`);
    if (format === 'text') {
        const shown = diagnostics.slice(0, maxErrors);
        for (const d of shown) {
            const where = d.line > 0 ? `:${d.line}${d.column > 0 ? `:${d.column}` : ''}` : '';
            lines.push(`    ${label}${where}  ${d.kind === 'warning' ? 'warning: ' : ''}${d.rule ? `[${d.rule}] ` : ''}${d.message}`);
            if (d.message_en) lines.push(`      in English: ${d.message_en}`);
            if (d.path) lines.push(`      at ${d.path}`);
        }
        const total = (validation.result?.errors_total ?? 0) + (validation.result?.warnings_total ?? 0);
        if (total > shown.length && shown.length > 0) {
            lines.push(`    … and ${plural(total - shown.length, 'more problem')}`);
        }
    }

    return lines;
}

/** The catalog rule sets that ran, with their releases, each once ("Peppol BIS Billing 3.0 rules 3.0.21"). */
export function ruleSets(validations) {
    const labels = [];
    for (const v of validations) {
        for (const set of [...(v.rule_sets ?? []), ...(v.result?.items ?? []).flatMap((item) => item.rule_sets ?? [])]) {
            const label = set.name.includes(set.version) ? set.name : `${set.name} ${set.version}`;
            if (!labels.includes(label)) labels.push(label);
        }
    }

    return labels;
}

/** A Markdown table for the GitHub job summary. */
function jobSummary(items, validations, failOnWarnings) {
    const rows = items.map((item, i) => `| ${passes(validations[i], failOnWarnings) ? '✅' : '❌'} | \`${item.file ?? item.url}\` | ${describe(validations[i])} |`);
    const failed = validations.filter((v) => !passes(v, failOnWarnings)).length;

    const sets = ruleSets(validations);

    return [`### xmlvalid: ${failed === 0 ? 'all valid' : `${plural(failed, 'document')} failed`}`, '', '| | Document | Result |', '|---|---|---|', ...rows, '', ...(sets.length ? [`Rules: ${sets.join(' · ')}`, ''] : [])].join('\n');
}

async function validateCommand(args, options, api, out, err = out) {
    if ([options.schema, options.schemaFile, options.doctype].filter(Boolean).length > 1) {
        throw new CliError('Use only one of --schema, --schema-file and --doctype.');
    }
    if (!['text', 'json', 'github'].includes(options.format)) {
        throw new CliError('--format is text, json or github.');
    }

    const rules = options.rules ? await collectRules(options.rules) : null;
    const files = await expandFiles(args);
    const items = [...files.map((file) => ({ file })), ...options.url.map((url) => ({ url }))];
    if (items.length === 0) {
        throw new CliError('Name at least one file, glob or --url. See xmlvalid --help.');
    }

    const validations = await pool(items, options.concurrency, async (item) => {
        const validation = await api.validate({ ...item, schema: options.schema, schemaFile: options.schemaFile, doctype: options.doctype, rules, rulesVersion: options.rulesVersion });
        if (options.format !== 'json') {
            out(render(item, validation, options).join('\n'));
        }

        return validation;
    });

    if (options.format === 'json') {
        out(JSON.stringify(items.map((item, i) => ({ ...item, ...validations[i] })), null, 2));
    } else {
        const failed = validations.filter((v) => !passes(v, options.failOnWarnings)).length;
        out(`\n${plural(items.length, 'document')}: ${items.length - failed} passed, ${failed} failed.`);
        const sets = ruleSets(validations);
        if (sets.length) out(`Rules: ${sets.join(' · ')}`);
    }

    if (options.report) {
        const report = fromApi(items.map((item, i) => ({ name: item.file ?? item.url, validation: validations[i] })), { origin: new URL(api.base).origin, generated: new Date().toISOString() });
        await mkdir(path.dirname(path.resolve(options.report)), { recursive: true });
        await writeFile(options.report, reportHtml(report));
        if (options.format !== 'json') out(`Report: ${options.report}`);
    }

    let link = null;
    if (options.share) {
        // A link that can't be made (Free plan, too many links) doesn't fail the run.
        const ids = validations.map((v) => v.id).filter(Boolean);
        try {
            link = ids.length ? (await api.request('POST', '/reports', { validations: ids })).json : null;
        } catch (error) {
            err(`No report link: ${error.message}`);
        }
        if (link) (options.format === 'json' ? err : out)(`Report link: ${link.url} (open until ${link.expires_at.slice(0, 10)})`);
    }

    if (options.format === 'github' && process.env.GITHUB_STEP_SUMMARY) {
        await appendFile(process.env.GITHUB_STEP_SUMMARY, jobSummary(items, validations, options.failOnWarnings) + (link ? `\n[Validation report](${link.url}), open until ${link.expires_at.slice(0, 10)}.\n` : '')).catch(() => {});
    }
    if (link && options.format === 'github' && process.env.GITHUB_OUTPUT) {
        await appendFile(process.env.GITHUB_OUTPUT, `report-url=${link.url}\n`).catch(() => {});
    }

    const crashed = validations.some((v) => v.status === 'failed' || v.result?.outcome === 'failed');
    const schemaBroken = validations.some((v) => v.result?.outcome === 'schema');

    if (validations.every((v) => passes(v, options.failOnWarnings))) return EXIT.ok;
    if (schemaBroken) return EXIT.usage;
    if (crashed) return EXIT.failure;

    return EXIT.invalid;
}

/** Runs the CLI; returns the exit code. `io` is replaceable for tests. */
export async function main(argv, io = {}) {
    const out = io.out ?? ((s) => process.stdout.write(s + '\n'));
    const err = io.err ?? ((s) => process.stderr.write(s + '\n'));
    const env = io.env ?? process.env;

    try {
        const { command, args, options } = parseArgs(argv);

        if (options.version) {
            out(VERSION);
            return EXIT.ok;
        }
        if (options.help || command === undefined || command === 'help') {
            out(HELP);
            return command === undefined && !options.help ? EXIT.usage : EXIT.ok;
        }

        const key = options.apiKey ?? env.XMLVALID_API_KEY;
        if (!key) {
            throw new CliError('Set XMLVALID_API_KEY (or pass --api-key). Make a key at https://xmlvalid.com/dashboard/api.');
        }
        const api = new Api({ key, base: options.apiUrl ?? env.XMLVALID_API_URL ?? DEFAULT_API, fetchImpl: io.fetch });

        switch (command) {
            case 'validate':
                return await validateCommand(args, options, api, out, err);
            case 'schemas': {
                const { json } = await api.request('GET', '/schemas');
                for (const [group, list] of [['Your schemas', json.saved], ['Catalog', json.catalog]]) {
                    if (list.length > 0) {
                        out(`${group}:`);
                        list.forEach((s) => out(`  ${s.schema.padEnd(32)} ${s.kind.toUpperCase().padEnd(4)} ${s.name}`));
                    }
                }
                return EXIT.ok;
            }
            case 'usage': {
                const { json } = await api.request('GET', '/usage');
                out(`${json.plan} plan: ${json.validations.used.toLocaleString('en-US')} of ${json.validations.limit.toLocaleString('en-US')} API validations used; resets ${json.period.reset_at.slice(0, 10)}.`);
                return EXIT.ok;
            }
            default:
                throw new CliError(`Unknown command "${command}". See xmlvalid --help.`);
        }
    } catch (error) {
        if (error instanceof CliError) {
            err(`xmlvalid: ${error.message}`);
            return error.code;
        }
        err(`xmlvalid: ${error.stack ?? error}`);
        return EXIT.failure;
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:fs')).realpathSync(process.argv[1])) {
    process.exitCode = await main(process.argv.slice(2));
}
