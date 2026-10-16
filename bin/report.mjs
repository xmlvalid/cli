/**
 * A validation report as one self-contained HTML page: the verdict, the
 * document and schema, and every finding with its line, the business rule's
 * page and the error guide's. It prints cleanly, so "Save as PDF" in the
 * browser's print dialog turns it into a PDF. No scripts but the print button,
 * no external files.
 *
 * The browser's Report button and the command-line client (which ships a copy
 * of this file, clients/cli/bin/report.mjs) use it; the API's report is
 * App\Reports\ValidationReport, a port that ReportParityTest holds to the
 * same output.
 */

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const number = (n) => (n ?? 0).toLocaleString('en-US');
const plural = (n, one, many) => `${number(n)} ${n === 1 ? one : many}`;

/** What a verdict says, as the validator words it. */
export function verdictText(verdict, errors, warnings) {
    return {
        valid: 'Document is valid',
        warnings: `Document is valid, with ${plural(warnings, 'warning', 'warnings')}`,
        invalid: `Document is invalid: ${plural(errors + warnings, 'issue', 'issues')}`,
        schema: 'The schema could not be loaded',
        input: 'The document could not be read',
        failed: 'The document could not be checked',
    }[verdict] ?? verdict;
}

/** Where a finding comes from: the business rule, the PDF layer or the parser. */
function source(d) {
    if (d.type === 'schematron') return d.rule ? `Business rule ${d.rule}` : 'Business rules';
    if (d.type === 'pdf') return `PDF/A-3 layer ${d.rule}`;
    return d.type ? `${d.type}${d.code ? ` · code ${d.code}` : ''}` : '';
}

function findingRows(diagnostics) {
    return diagnostics
        .map((d) => {
            const where = d.ruleUrl ? `<a href="${escape(d.ruleUrl)}">${escape(source(d))}</a>` : escape(source(d));
            const level = String(d.level ?? 'ERROR').toLowerCase();
            return `<tr>
<td class="line">${d.line > 0 ? `${number(d.line)}${d.column > 0 ? `:${d.column}` : ''}` : 'document'}</td>
<td><span class="chip ${level === 'warning' ? 'warn' : 'err'}">${escape(level)}</span></td>
<td>${escape(d.message)}${d.english ? `<div class="en">In English: ${escape(d.english)}</div>` : ''}<div class="meta">${where}${d.file ? ` · ${escape(d.file)}` : ''}${d.guideUrl ? ` · <a href="${escape(d.guideUrl)}">what does this mean?</a>` : ''}</div></td>
</tr>`;
        })
        .join('\n');
}

function findingsTable(diagnostics) {
    if (!diagnostics.length) return '';
    return `<table><thead><tr><th>Line</th><th>Level</th><th>Finding</th></tr></thead><tbody>
${findingRows(diagnostics)}
</tbody></table>`;
}

const tone = (verdict) => (verdict === 'valid' ? 'ok' : verdict === 'warnings' ? 'warn' : 'err');

/**
 * @param {object} report
 * @param {string} report.title The page title, such as the document's name
 * @param {string} report.generated When the documents were checked (ISO 8601)
 * @param {string} report.origin The site that checked them (https://xmlvalid.com)
 * @param {'browser'|'api'} [report.via] Where they were checked
 * @param {?string} report.schema The schema or catalog entry, null for well-formedness only
 * @param {?string} [report.rules] Rules of the user's own that ran after the schema
 * @param {{ name: string, verdict: ?string, errors: number, warnings: number, size?: number, note?: string,
 *           schemaErrors?: object[], diagnostics: object[] }[]} report.documents Findings carry `ruleUrl` and `guideUrl`, absolute, and `english` for a rule written in another language
 * @param {?{ total: number, passed: number, failed: number, skipped: number }} [report.summary] A batch's counts
 * @param {?string} [report.note] A line above the footer, such as when a shared link expires
 */
export function reportHtml({ title, generated, origin, via = 'browser', schema, rules = null, documents, summary = null, note = null }) {
    const date = new Date(generated).toUTCString().replace('GMT', 'UTC');
    const host = new URL(origin).host;
    const ruled = documents.some((doc) => [...(doc.schemaErrors ?? []), ...doc.diagnostics].some((d) => d.ruleUrl));

    const single = documents.length === 1 && !summary;
    const head = single
        ? `<div class="verdict ${tone(documents[0].verdict)}">${escape(verdictText(documents[0].verdict, documents[0].errors, documents[0].warnings))}</div>`
        : `<div class="verdict ${summary.failed ? 'err' : 'ok'}">${summary.failed ? `${number(summary.failed)} of ${plural(summary.total, 'document', 'documents')} failed` : `All ${plural(summary.passed, 'document', 'documents')} checked are valid`}</div>
<p class="counts">${number(summary.passed)} passed · ${number(summary.failed)} failed${summary.skipped ? ` · ${number(summary.skipped)} not checked` : ''}</p>`;

    const facts = [
        ['Schema', schema ?? 'Well-formedness only'],
        ...(rules ? [['Rules', rules]] : []),
        ...(single && documents[0].size != null ? [['Size', `${number(documents[0].size)} bytes`]] : []),
        ['Checked', date],
    ];

    const sections = documents
        .map((doc) => {
            const issues = (doc.schemaErrors?.length ?? 0) + doc.diagnostics.length;
            const shown = doc.errors + doc.warnings > doc.diagnostics.length;
            const heading = single
                ? (issues ? '' : '<p>No errors or warnings.</p>')
                : `<h2><span class="dot ${doc.verdict ? tone(doc.verdict) : 'idle'}"></span>${escape(doc.name)}</h2>
<p class="meta">${escape(doc.verdict ? verdictText(doc.verdict, doc.errors, doc.warnings) : 'Not checked')}${doc.note ? ` · ${escape(doc.note)}` : ''}</p>`;
            return `<section>
${heading}
${doc.schemaErrors?.length ? `<h3>Schema problems</h3>${findingsTable(doc.schemaErrors)}` : ''}
${findingsTable(doc.diagnostics)}
${shown && issues ? `<p class="meta">The first ${number(doc.diagnostics.length)} of ${number(doc.errors + doc.warnings)} findings are listed.</p>` : ''}
</section>`;
        })
        .join('\n');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · validation report</title>
<style>
:root { color-scheme: light; --ok: #15803d; --warn: #b45309; --err: #b91c1c; --line: #e5e5e5; --muted: #525252; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #171717; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 32px 16px 48px; }
header { display: flex; flex-wrap: wrap; gap: 12px; align-items: baseline; justify-content: space-between; border-bottom: 1px solid var(--line); padding-bottom: 16px; margin-bottom: 20px; }
header h1 { margin: 0; font-size: 20px; overflow-wrap: anywhere; }
header .brand { color: var(--muted); font-size: 13px; text-decoration: none; }
.verdict { font-size: 18px; font-weight: 600; padding: 12px 16px; border-radius: 8px; border: 1px solid; }
.verdict.ok { color: var(--ok); border-color: #bbf7d0; background: #f0fdf4; }
.verdict.warn { color: var(--warn); border-color: #fde68a; background: #fffbeb; }
.verdict.err { color: var(--err); border-color: #fecaca; background: #fef2f2; }
.counts { margin: 8px 0 0; color: var(--muted); }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 16px 0 8px; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }
section { margin-top: 28px; break-inside: auto; }
h2 { display: flex; gap: 8px; align-items: center; font-size: 15px; margin: 0 0 2px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
h3 { font-size: 13px; margin: 12px 0 4px; color: var(--muted); }
.meta { color: var(--muted); font-size: 12px; margin: 2px 0 0; overflow-wrap: anywhere; }
.en { font-size: 13px; margin: 2px 0 0; overflow-wrap: anywhere; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: fixed; }
th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); border-bottom: 1px solid var(--line); padding: 6px 8px; }
th:nth-child(1) { width: 90px; } th:nth-child(2) { width: 80px; }
td { vertical-align: top; border-bottom: 1px solid var(--line); padding: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; overflow-wrap: anywhere; }
tr { break-inside: avoid; }
td.line { white-space: nowrap; color: var(--muted); }
.chip { display: inline-block; border-radius: 4px; padding: 0 6px; font-size: 11px; }
.chip.err { color: var(--err); background: #fef2f2; }
.chip.warn { color: var(--warn); background: #fffbeb; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex: none; background: #a3a3a3; }
.dot.ok { background: var(--ok); } .dot.warn { background: var(--warn); } .dot.err { background: var(--err); }
a { color: #4338ca; }
.note { margin-top: 16px; }
footer { margin-top: 36px; border-top: 1px solid var(--line); padding-top: 12px; color: var(--muted); font-size: 12px; }
.print { font: inherit; font-size: 13px; padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; background: #fff; cursor: pointer; }
@media (max-width: 560px) { th:nth-child(1) { width: 64px; } th:nth-child(2) { width: 64px; } td { padding: 6px 4px; } }
@media print { main { padding: 0; max-width: none; } .print { display: none; } a { color: inherit; text-decoration: none; } }
</style>
</head>
<body>
<main>
<header>
<h1>${escape(title)}</h1>
<span><button class="print" type="button" onclick="print()">Save as PDF</button> <a class="brand" href="${escape(origin)}">${escape(host)}</a></span>
</header>
${head}
<dl>${facts.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl>
${sections}
${note ? `<p class="meta note">${escape(note)}</p>\n` : ''}<footer>${via === 'api' ? `Validated with the <a href="${escape(origin)}">${escape(host)}</a> API.` : `Validated in the browser at <a href="${escape(origin)}">${escape(host)}</a>.`}${ruled ? ' Rule ids link to what each rule checks and how to fix it.' : ''}</footer>
</main>
</body>
</html>
`;
}

const VERDICTS = ['valid', 'warnings', 'invalid', 'schema', 'input', 'failed'];

/** A document's findings from an API result, in document order. */
function apiFindings(result) {
    return [...(result.errors ?? []), ...(result.warnings ?? [])]
        .map((d, i) => ({ d, i }))
        .sort((a, b) => a.d.line - b.d.line || a.i - b.i)
        .map(({ d }) => ({ type: d.type, level: d.level, line: d.line, column: d.column, message: d.message, rule: d.rule, english: d.message_en ?? null, ruleUrl: d.rule_url ?? null, guideUrl: d.help_url ?? null }));
}

function apiDocument(name, validation) {
    const result = validation.result;
    if (!result) {
        return { name, verdict: 'failed', errors: 0, warnings: 0, note: validation.error ?? validation.status, diagnostics: [] };
    }
    const verdict = VERDICTS.includes(result.outcome) ? result.outcome : null;
    return {
        name,
        verdict,
        errors: result.errors_total ?? 0,
        warnings: result.warnings_total ?? 0,
        size: result.bytes,
        ...(verdict === null ? { note: result.note ?? 'not checked' } : {}),
        diagnostics: apiFindings(result),
    };
}

/**
 * The report of API validations (GET /api/v1/validations/{id}), each named by
 * its file or URL. An archive lists its documents as "orders.zip!a.xml".
 *
 * @param {{ name: string, validation: object }[]} entries
 * @param {{ origin: string, generated: string }} options
 */
export function fromApi(entries, { origin, generated }) {
    const documents = entries.flatMap(({ name, validation }) =>
        validation.result?.items ? validation.result.items.map((item) => apiDocument(`${name}!${item.name}`, { result: item })) : [apiDocument(name, validation)],
    );
    const batch = entries.length > 1 || entries.some(({ validation }) => validation.result?.items);
    const passed = documents.filter((d) => d.verdict === 'valid' || d.verdict === 'warnings').length;
    const skipped = documents.filter((d) => d.verdict === null).length;
    const schema = entries.map(({ validation }) => validation.schema).find(Boolean) ?? null;
    const rules = entries.map(({ validation }) => validation.rules?.name).find(Boolean) ?? null;

    return {
        title: batch ? plural(documents.length, 'document', 'documents') : documents[0]?.name ?? 'Validation',
        generated,
        origin,
        via: 'api',
        schema: schema ? (schema.kind === 'doctype' ? 'The document\'s own DOCTYPE' : `${schema.name ?? schema.catalog ?? schema.saved} · ${String(schema.kind).toUpperCase()}`) : null,
        rules,
        documents,
        summary: batch ? { total: documents.length, passed, failed: documents.length - passed - skipped, skipped } : null,
    };
}
