import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main, parseArgs, expandFiles, describe, passes, render } from '../bin/xmlvalid.mjs';

/** A stand-in for the API: answers each POST from `outcomes` by file name. */
async function fakeApi(handler) {
    const seen = [];
    const server = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString('latin1');
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
        const [status, json, headers = {}] = await handler(req, body, seen.length);
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(JSON.stringify(json));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;

    return { base, seen, close: () => new Promise((resolve) => server.close(resolve)) };
}

const done = (id, result) => ({ id, status: 'done', result, links: { self: `/api/v1/validations/${id}` } });
const valid = { valid: true, outcome: 'valid', errors_total: 0, warnings_total: 0, errors: [], warnings: [] };
const invalid = {
    valid: false, outcome: 'invalid', errors_total: 2, warnings_total: 0, warnings: [],
    errors: [
        { line: 3, column: 5, level: 'error', type: 'xsd', message: "Element 'qty': 'many' is not a valid value." },
        { line: 9, column: 1, level: 'error', type: 'xsd', message: 'Missing child element(s).' },
    ],
};

async function workspace(files) {
    const dir = await mkdtemp(path.join(tmpdir(), 'xmlvalid-cli-'));
    for (const [name, content] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
        await writeFile(path.join(dir, name), content);
    }

    return dir;
}

async function run(argv, { base, env = {}, cwd } = {}) {
    const out = [];
    const err = [];
    const previous = process.cwd();
    if (cwd) process.chdir(cwd);
    try {
        const code = await main(argv, {
            out: (s) => out.push(s),
            err: (s) => err.push(s),
            env: { XMLVALID_API_KEY: 'xv_test', XMLVALID_API_URL: base, ...env },
        });

        return { code, out: out.join('\n'), err: err.join('\n') };
    } finally {
        process.chdir(previous);
    }
}

test('parses options in both spellings', () => {
    const { command, args, options } = parseArgs(['validate', 'a.xml', '-s', 'atom-1.0', '--format=github', '-j', '2', '--url', 'https://x/a.xml', '--fail-on-warnings']);
    assert.equal(command, 'validate');
    assert.deepEqual(args, ['a.xml']);
    assert.equal(options.schema, 'atom-1.0');
    assert.equal(options.format, 'github');
    assert.equal(options.concurrency, 2);
    assert.deepEqual(options.url, ['https://x/a.xml']);
    assert.equal(options.failOnWarnings, true);
    assert.throws(() => parseArgs(['validate', '--nope']), /Unknown option/);
    assert.throws(() => parseArgs(['validate', '-j', 'zero']), /whole number/);
});

test('expands globs below their fixed prefix, sorted and without duplicates', async () => {
    const dir = await workspace({ 'feeds/a.xml': '', 'feeds/deep/b.xml': '', 'feeds/c.txt': '', 'other/d.xml': '', 'node_modules/x.xml': '' });
    try {
        assert.deepEqual(await expandFiles(['feeds/**/*.xml'], dir), ['feeds/a.xml', 'feeds/deep/b.xml']);
        assert.deepEqual(await expandFiles(['**/*.xml', 'feeds/a.xml'], dir), ['feeds/a.xml', 'feeds/deep/b.xml', 'other/d.xml']);
        assert.deepEqual(await expandFiles(['feeds/*.{xml,txt}'], dir), ['feeds/a.xml', 'feeds/c.txt']);
        await assert.rejects(expandFiles(['missing.xml'], dir), /No such file/);
        await assert.rejects(expandFiles(['*.json'], dir), /Nothing matches/);
    } finally {
        await rm(dir, { recursive: true });
    }
});

test('validates files, prints errors and exits 1 when one is invalid', async () => {
    const dir = await workspace({ 'good.xml': '<a/>', 'bad.xml': '<a>' });
    const api = await fakeApi((req, body) => [200, done('val_1', body.includes('filename="bad.xml"') ? invalid : valid)]);
    try {
        const { code, out } = await run(['validate', 'good.xml', 'bad.xml', '--schema', 'atom-1.0'], { base: api.base, cwd: dir });

        assert.equal(code, 1);
        assert.match(out, /✓ good\.xml {2}valid/);
        assert.match(out, /✗ bad\.xml {2}2 errors/);
        assert.match(out, /bad\.xml:3:5 {2}Element 'qty'/);
        assert.match(out, /2 documents: 1 passed, 1 failed\./);
        assert.equal(api.seen[0].auth, 'Bearer xv_test');
        assert.match(api.seen[0].body, /name="schema"\r\n\r\natom-1\.0/);
    } finally {
        await api.close();
        await rm(dir, { recursive: true });
    }
});

test('sends Schematron rules and prints the rule of each finding', async () => {
    const dir = await workspace({
        'invoice.xml': '<a/>',
        'rules/my.sch': '<schema xmlns="http://purl.oclc.org/dsdl/schematron"><include href="../common/totals.sch"/><include href="#local"/></schema>',
        'common/totals.sch': '<pattern xmlns="http://purl.oclc.org/dsdl/schematron"><rule context="a"><extends href="base.sch#r"/></rule></pattern>',
        'common/base.sch': '<rule xmlns="http://purl.oclc.org/dsdl/schematron" abstract="true" id="r"/>',
    });
    const broken = {
        valid: false, outcome: 'invalid', errors_total: 1, warnings_total: 0, warnings: [],
        errors: [{ line: 4, column: 0, level: 'error', type: 'schematron', rule: 'BR-CO-15', message: 'Totals do not add up.' }],
    };
    const api = await fakeApi(() => [200, done('val_1', broken)]);
    try {
        const { code, out } = await run(['validate', 'invoice.xml', '--rules', 'rules/my.sch'], { base: api.base, cwd: dir });

        assert.equal(code, 1);
        assert.match(out, /invoice\.xml:4 {2}\[BR-CO-15\] Totals do not add up\./);
        assert.match(api.seen[0].body, /name="rules_file\[\]"; filename="my\.sch"/);
        assert.match(api.seen[0].body, /name="rules_path\[\]"\r\n\r\nrules\/my\.sch\r\n/);
        assert.match(api.seen[0].body, /name="rules_path\[\]"\r\n\r\ncommon\/totals\.sch\r\n/);
        assert.match(api.seen[0].body, /name="rules_path\[\]"\r\n\r\ncommon\/base\.sch\r\n/);
    } finally {
        await api.close();
        await rm(dir, { recursive: true });
    }
});

test('names an included file that is missing', async () => {
    const dir = await workspace({ 'a.xml': '<a/>', 'my.sch': '<schema xmlns="http://purl.oclc.org/dsdl/schematron"><include href="gone.sch"/></schema>' });
    try {
        const { code, err } = await run(['validate', 'a.xml', '--rules', 'my.sch'], { base: 'http://127.0.0.1:9', cwd: dir });

        assert.equal(code, 2);
        assert.match(err, /my\.sch includes gone\.sch, which does not exist\./);
    } finally {
        await rm(dir, { recursive: true });
    }
});

test('polls a validation that is still running', async () => {
    const dir = await workspace({ 'big.xml': '<a/>' });
    const api = await fakeApi((req, body, n) => n === 1
        ? [202, { id: 'val_2', status: 'queued', links: { self: 'unused' } }, { Location: `http://${req.headers.host}/api/v1/validations/val_2` }]
        : n === 2 ? [200, { id: 'val_2', status: 'running' }] : [200, done('val_2', valid)]);
    try {
        const { Api } = await import('../bin/xmlvalid.mjs');
        const client = new Api({ key: 'xv_test', base: api.base });
        const validation = await client.validate({ file: path.join(dir, 'big.xml') }, { pollEvery: 10 });

        assert.equal(validation.status, 'done');
        assert.deepEqual(api.seen.map((r) => `${r.method} ${r.url}`), ['POST /api/v1/validations', 'GET /api/v1/validations/val_2', 'GET /api/v1/validations/val_2']);
    } finally {
        await api.close();
        await rm(dir, { recursive: true });
    }
});

test('writes GitHub annotations and a job summary', async () => {
    const dir = await workspace({ 'feeds/bad.xml': '<a>' });
    const summary = path.join(dir, 'summary.md');
    const api = await fakeApi(() => [200, done('val_3', invalid)]);
    process.env.GITHUB_STEP_SUMMARY = summary;
    try {
        const { code, out } = await run(['validate', 'feeds/*.xml', '-f', 'github'], { base: api.base, cwd: dir });

        assert.equal(code, 1);
        assert.match(out, /::error file=feeds\/bad\.xml,line=3,col=5,title=xmlvalid%3A xsd::Element 'qty'/);
        assert.match(await readFile(summary, 'utf8'), /\| ❌ \| `feeds\/bad\.xml` \| 2 errors \|/);
    } finally {
        delete process.env.GITHUB_STEP_SUMMARY;
        await api.close();
        await rm(dir, { recursive: true });
    }
});

test('prints JSON for scripts', async () => {
    const api = await fakeApi(() => [200, done('val_4', valid)]);
    try {
        const { code, out } = await run(['validate', '--url', 'https://example.com/a.xml', '-f', 'json'], { base: api.base });

        assert.equal(code, 0);
        assert.deepEqual(JSON.parse(out).map((v) => [v.url, v.result.outcome]), [['https://example.com/a.xml', 'valid']]);
        assert.match(api.seen[0].body, /name="url"\r\n\r\nhttps:\/\/example\.com\/a\.xml/);
    } finally {
        await api.close();
    }
});

test('stops on an API error with exit 2 and its message', async () => {
    const api = await fakeApi(() => [429, { error: { code: 'quota_exceeded', message: "You have used this month's 100 API validations on the Free plan." } }]);
    try {
        const { code, err } = await run(['validate', '--url', 'https://example.com/a.xml'], { base: api.base });

        assert.equal(code, 2);
        assert.match(err, /100 API validations/);
    } finally {
        await api.close();
    }
});

test('waits out the per-minute rate limit', async () => {
    const api = await fakeApi((req, body, n) => n === 1
        ? [429, { error: { code: 'rate_limited', message: 'Too many requests.' } }, { 'Retry-After': '0' }]
        : [200, done('val_5', valid)]);
    try {
        const { code } = await run(['validate', '--url', 'https://example.com/a.xml'], { base: api.base });

        assert.equal(code, 0);
        assert.equal(api.seen.length, 2);
    } finally {
        await api.close();
    }
});

test('needs a key and a target', async () => {
    assert.equal((await run(['validate', 'a.xml'], { env: { XMLVALID_API_KEY: '' } })).code, 2);
    assert.match((await run(['validate'], { base: 'http://127.0.0.1:9' })).err, /at least one file/);
    assert.match((await run(['validate', '--url', 'https://x/a.xml', '--schema', 'a', '--doctype'], { base: 'http://127.0.0.1:9' })).err, /only one of/);
});

test('reports a server it cannot reach with exit 3', async () => {
    const { code, err } = await run(['usage'], { base: 'http://127.0.0.1:9/api/v1' });

    assert.equal(code, 3);
    assert.match(err, /Could not reach/);
});

test('lists schemas and usage', async () => {
    const api = await fakeApi((req) => req.url.endsWith('/schemas')
        ? [200, { saved: [{ schema: 'my-3', kind: 'xsd', name: 'Orders' }], catalog: [{ schema: 'atom-1.0', kind: 'rnc', name: 'Atom 1.0' }] }]
        : [200, { plan: 'free', period: { reset_at: '2026-11-01T00:00:00Z' }, validations: { used: 12, limit: 100 } }]);
    try {
        assert.match((await run(['schemas'], { base: api.base })).out, /my-3 +XSD +Orders[\s\S]*atom-1\.0 +RNC +Atom 1\.0/);
        assert.match((await run(['usage'], { base: api.base })).out, /free plan: 12 of 100 API validations used; resets 2026-11-01\./);
    } finally {
        await api.close();
    }
});

test('describes outcomes and decides what passes', () => {
    assert.equal(describe(done('v', { ...valid, outcome: 'warnings', warnings_total: 1 })), 'valid, 1 warning');
    assert.equal(describe({ status: 'failed', result: null, error: 'Validation failed unexpectedly.' }), 'Validation failed unexpectedly.');
    assert.equal(passes(done('v', { ...valid, outcome: 'warnings' })), true);
    assert.equal(passes(done('v', { ...valid, outcome: 'warnings' }), true), false);
    assert.deepEqual(render({ file: 'a.xml' }, done('v', invalid), { format: 'text', maxErrors: 1 }).slice(-1), ['    … and 1 more problem']);
});

test('adds the English of a rule written in another language', () => {
    const croatian = { ...invalid, errors_total: 1, errors: [{ line: 2, column: 0, level: 'error', type: 'schematron', rule: 'HR-BR-9', message: 'Račun mora sadržavati ispravan OIB operatera (HR-BT-5)', message_en: 'The invoice must contain the operator\'s valid OIB (HR-BT-5).' }] };

    assert.deepEqual(render({ file: 'r.xml' }, done('v', croatian), { format: 'text', maxErrors: 5 }).slice(1), [
        '    r.xml:2  [HR-BR-9] Račun mora sadržavati ispravan OIB operatera (HR-BT-5)',
        "      in English: The invoice must contain the operator's valid OIB (HR-BT-5).",
    ]);
    assert.match(render({ file: 'r.xml' }, done('v', croatian), { format: 'github', maxErrors: 5 })[0], /OIB operatera \(HR-BT-5\) \(The invoice must contain/);
});

test('lists the documents of an archive under it', () => {
    const archive = {
        valid: false, outcome: 'invalid', errors_total: 2, warnings_total: 0, errors: [], warnings: [],
        documents: { total: 3, passed: 1, failed: 1, skipped: 1 },
        items: [
            { name: 'a.xml', schema: 'order.xsd', ...valid },
            { name: 'b.xml', schema: 'order.xsd', ...invalid },
            { name: 'big.xml', schema: null, outcome: 'skipped', note: 'larger than the file limit' },
        ],
    };

    assert.deepEqual(render({ file: 'orders.zip' }, done('v', archive), { format: 'text', maxErrors: 20 }), [
        '✗ orders.zip  3 documents, 1 failed, 1 skipped',
        '  ✓ orders.zip!a.xml  valid',
        '  ✗ orders.zip!b.xml  2 errors',
        "      orders.zip!b.xml:3:5  Element 'qty': 'many' is not a valid value.",
        '      orders.zip!b.xml:9:1  Missing child element(s).',
        '  - orders.zip!big.xml  skipped: larger than the file limit',
    ]);
    assert.equal(render({ file: 'orders.zip' }, done('v', archive), { format: 'github', maxErrors: 20 })[2], "::error line=3,col=5,title=xmlvalid%3A orders.zip!b.xml::Element 'qty': 'many' is not a valid value.");
});

test('writes an HTML report of every document', async () => {
    const api = await fakeApi((req, body) => [201, done('v1', body.includes('bad.xml') ? invalid : valid)]);
    const dir = await workspace({ 'good.xml': '<a/>', 'bad.xml': '<a/>' });
    try {
        const { code, out } = await run(['validate', 'good.xml', 'bad.xml', '--report', 'out/report.html'], { base: api.base, cwd: dir });
        const html = await readFile(path.join(dir, 'out/report.html'), 'utf8');

        assert.equal(code, 1);
        assert.match(out, /Report: out\/report\.html/);
        assert.match(html, /<div class="verdict err">1 of 2 documents failed<\/div>/);
        assert.match(html, /<h2><span class="dot err"><\/span>bad\.xml<\/h2>/);
        assert.match(html, /Element &#39;qty&#39;: &#39;many&#39; is not a valid value\./);
        assert.match(html, /Validated with the <a href="http:\/\/127\.0\.0\.1:\d+">127\.0\.0\.1:\d+<\/a> API\./);
    } finally {
        await api.close();
        await rm(dir, { recursive: true, force: true });
    }
});

test('shares one report link for the whole run, and carries on without one', async () => {
    let n = 0;
    const api = await fakeApi((req, body) => req.url.endsWith('/reports')
        ? [201, { url: 'https://xmlvalid.com/reports/01jzexample', expires_at: '2026-11-15T12:00:00+00:00' }]
        : [201, done(`v${++n}`, body.includes('bad.xml') ? invalid : valid)]);
    const dir = await workspace({ 'good.xml': '<a/>', 'bad.xml': '<a/>' });
    try {
        const { code, out } = await run(['validate', 'good.xml', 'bad.xml', '--share'], { base: api.base, cwd: dir });
        const share = api.seen.find((r) => r.url.endsWith('/reports'));

        assert.equal(code, 1);
        assert.deepEqual(JSON.parse(share.body).validations.sort(), ['v1', 'v2']);
        assert.match(out, /Report link: https:\/\/xmlvalid\.com\/reports\/01jzexample \(open until 2026-11-15\)/);
    } finally {
        await api.close();
    }

    const free = await fakeApi((req) => req.url.endsWith('/reports')
        ? [403, { error: { code: 'plan_limit', message: 'Report links are part of the Pro plan.' } }]
        : [201, done('v1', valid)]);
    try {
        const { code, err } = await run(['validate', 'good.xml', '--share'], { base: free.base, cwd: dir });
        assert.equal(code, 0);
        assert.match(err, /No report link: Report links are part of the Pro plan\./);
    } finally {
        await free.close();
        await rm(dir, { recursive: true, force: true });
    }
});

test('pins rule set releases and names the ones that ran', async () => {
    const dir = await workspace({ 'invoice.xml': '<Invoice/>' });
    const sets = [{ key: 'en16931-ubl-1.3.16', name: 'EN 16931 rules 1.3.16 (UBL)', version: '1.3.16' }, { key: 'peppol-bis-3-ubl', name: 'Peppol BIS Billing 3.0 rules', version: '3.0.21' }];
    const api = await fakeApi(() => [200, { ...done('val_1', valid), rule_sets: sets }]);
    try {
        const { code, out } = await run(['validate', 'invoice.xml', '-s', 'peppol-bis-3-invoice', '--rules-version', 'peppol-bis-3-ubl@3.0.21', '--rules-version=en16931-ubl-1.3.16@1.3.16'], { base: api.base, cwd: dir });

        assert.equal(code, 0);
        assert.match(out, /Rules: EN 16931 rules 1\.3\.16 \(UBL\) · Peppol BIS Billing 3\.0 rules 3\.0\.21/);
        assert.match(api.seen[0].body, /name="rules_version\[\]"\r\n\r\npeppol-bis-3-ubl@3\.0\.21\r\n/);
        assert.match(api.seen[0].body, /name="rules_version\[\]"\r\n\r\nen16931-ubl-1\.3\.16@1\.3\.16\r\n/);
    } finally {
        await api.close();
        await rm(dir, { recursive: true });
    }
});

test('stops with exit 2 when a pinned rule set has moved on', async () => {
    const api = await fakeApi(() => [409, { error: { code: 'rules_version_mismatch', message: 'Peppol BIS Billing 3.0 rules runs release 3.0.22 now, not 3.0.21.', rule_set: 'peppol-bis-3-ubl', pinned: '3.0.21', current: '3.0.22' } }]);
    try {
        const { code, err } = await run(['validate', '--url', 'https://example.com/a.xml', '--rules-version', 'peppol-bis-3-ubl@3.0.21'], { base: api.base });

        assert.equal(code, 2);
        assert.match(err, /runs release 3\.0\.22 now/);
    } finally {
        await api.close();
    }
});
