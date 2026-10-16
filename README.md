# @xmlvalid/cli

Validate XML files against XSD 1.0, DTD and RelaxNG schemas from your terminal, a
Git hook or CI, using the [xmlvalid.com](https://xmlvalid.com) API. No dependencies;
Node.js 20 or newer.

```sh
npm install -g @xmlvalid/cli
export XMLVALID_API_KEY=xv_…        # https://xmlvalid.com/dashboard/api

xmlvalid validate invoices/*.xml --schema ubl-2.1-invoice
xmlvalid validate "feeds/**/*.atom" --schema atom-1.0 --format github
xmlvalid validate order.xml --schema-file schemas/order.xsd
xmlvalid validate --url https://example.com/sitemap.xml --schema sitemap-0.9
xmlvalid schemas     # catalog slugs and your saved schemas (my-12)
xmlvalid usage
```

Each document counts as one API validation (Free: 100 a month, Pro: 10,000).
A schema that spans several files can be saved once in the dashboard and used as
`--schema my-12`.

A `.zip` is validated document by document on the server (its XML files, against the
schema) and an `.epub` file by file against its own schemas; the documents are listed
under the archive as `orders.zip!orders/order-1.xml`, and each one checked counts as
an API validation. A Factur-X, ZUGFeRD or XRechnung `.pdf` has its XML invoice
validated (with the profile it names when no `--schema` is given), and problems with
the PDF around it are listed as `[PDF-…]` findings.

## Options

| Option | |
|---|---|
| `-s, --schema <name>` | a catalog slug (`atom-1.0`), a saved schema (`my-12`), or `auto` for the profile each e-invoice names (Peppol, XRechnung, French, KSeF…) |
| `--schema-file <path>` | one XSD, DTD or RelaxNG file sent with each document |
| `--rules <path>` | your own Schematron (`.sch`) file, run after the schema check; findings show their rule id |
| `--doctype` | validate against each document's own DOCTYPE |
| `--url <address>` | a document at a public URL (repeatable) |
| `-f, --format <format>` | `text`, `json` or `github` (annotations and a job summary) |
| `--fail-on-warnings` | treat warnings as failures |
| `--report <file.html>` | also write an HTML report of every document, with links to each rule (open it and print it to save a PDF) |
| `--share` | also make a public link to that report, open for 30 days (Pro); printed at the end and added to the GitHub job summary |
| `-j, --concurrency <n>` | documents validated at once, default 4 |
| `--max-errors <n>` | errors printed per document, default 20 |
| `--api-key`, `--api-url` | default to `XMLVALID_API_KEY`, `XMLVALID_API_URL` |

Globs support `*`, `**`, `?` and `{a,b}`; quote them so the shell leaves them alone.

Exit codes: `0` all valid, `1` a document is invalid, `2` a usage, schema or quota
problem, `3` a network or server error.

## GitHub Actions

```yaml
- uses: xmlvalid/validate-action@v1
  with:
    files: "feeds/**/*.xml"
    schema: atom-1.0
    api-key: ${{ secrets.XMLVALID_API_KEY }}
```

## pre-commit

```yaml
repos:
  - repo: https://github.com/xmlvalid/cli
    rev: v1.0.0
    hooks:
      - id: xmlvalid
        args: [--schema, atom-1.0]
```

More: https://xmlvalid.com/docs/ci
