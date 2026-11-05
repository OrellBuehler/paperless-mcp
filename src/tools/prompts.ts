import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function user(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

function previousMonth(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "triage_inbox",
    {
      description:
        "Classify inbox documents missing a correspondent, document type or tags; applies changes only after confirmation",
    },
    () =>
      user(`Triage my Paperless inbox.

1. Read the paperless://tags, paperless://correspondents and paperless://document-types resources (or call \`list_tags\`, \`list_correspondents\`, \`list_document_types\`) so you know the existing taxonomy.
2. Call \`process_inbox\` to get the inbox documents with Paperless's own suggestions. Focus on documents missing a correspondent, document type or tags. When a suggestion is weak or missing, read the text with \`get_document_content\`.
3. Show a table: document id, current title, and your proposed title, correspondent, document type and tags. Prefer existing objects; clearly flag any new correspondent, type or tag you would have to create.
4. Stop and wait for my confirmation. Then apply only what I approved with \`update_document\` (its \`tags\` replaces all tags, so pass the full list) or \`bulk_edit_documents\` for groups sharing the same change. Keep the inbox tag unless I ask you to remove it.

Do not create, change or delete anything before I confirm.`),
  );

  server.registerPrompt(
    "tax_prep",
    {
      description:
        "Gather a year's tax-relevant documents and spot missing recurring ones (salary certificate, bank statements, ...)",
      argsSchema: {
        year: z
          .string()
          .regex(/^\d{4}$/)
          .describe("Tax year, e.g. 2025"),
      },
    },
    ({ year }) => {
      const prev = Number(year) - 1;
      return user(`Help me prepare my ${year} tax documents.

1. Call \`yearly_document_check\` with year ${year}. It lists correspondent + document type combinations that exist for ${prev} but not for ${year}; treat them as likely missing recurring documents (salary certificate, bank tax statement, pension or insurance summary, ...).
2. Gather the tax-relevant documents of ${year}: use \`list_documents\` with created__date__gte ${year}-01-01 and created__date__lte ${year}-12-31, filtered by the relevant document types or tags (see paperless://document-types and paperless://tags), and with \`query\` for terms such as tax, salary, interest, donation, receipt, medical or insurance.
3. Produce a checklist grouped by category (income, banking and investments, insurance, deductions, other) with document id, title, correspondent and date, followed by the list of likely missing documents.

This is read-only: do not modify any document unless I ask.`);
    },
  );

  server.registerPrompt(
    "monthly_review",
    {
      description: "Review a month's documents: overview, unclassified documents and action items",
      argsSchema: {
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional()
          .describe("Month as YYYY-MM (default: previous month)"),
      },
    },
    ({ month }) => {
      const { year, month: m } = month
        ? { year: Number(month.slice(0, 4)), month: Number(month.slice(5)) }
        : previousMonth();
      const pad = (n: number) => String(n).padStart(2, "0");
      const start = `${year}-${pad(m)}-01`;
      const end = m === 12 ? `${year + 1}-01-01` : `${year}-${pad(m + 1)}-01`;
      return user(`Review my Paperless documents for ${year}-${pad(m)}.

1. Call \`monthly_summary\` with year ${year} and month ${m} for an overview.
2. Call \`list_documents\` with added__date__gte ${start} and added__date__lt ${end} to see what arrived. Flag documents still in the inbox or missing a correspondent, document type or tags.
3. Read the relevant ones with \`get_documents\` (set max_content_length, e.g. 5000) and pick out action items: bills to pay, deadlines, contracts to renew, anything that needs a reply.
4. Summarize: counts by correspondent and document type, unclassified documents with a proposed classification, and the action items with due dates.

Do not change anything without my confirmation.`);
    },
  );

  server.registerPrompt(
    "find_document",
    {
      description:
        "Find a document from a free-form description using filters, full-text and semantic search",
      argsSchema: { description: z.string().describe("What the document is about or looks like") },
    },
    ({ description }) =>
      user(`Find the Paperless document I am describing: ${description}

1. If the description names a sender, document type, tag or time frame, resolve them via the paperless://correspondents, paperless://document-types and paperless://tags resources and use \`list_documents\` with correspondent__id, document_type__id, tags__id__all and created__date__gte/lte.
2. For exact words, names, amounts or reference numbers likely in the text, use full-text search: \`search_documents\`, or \`list_documents\` with \`query\` combined with the filters above. \`search_autocomplete\` shows which terms the index knows.
3. If the \`semantic_search\` tool is available, use it for vague or conceptual descriptions where the wording is unknown, and cross-check its hits with full-text results.
4. If nothing matches, broaden step by step: drop filters, try synonyms, other languages and spellings.
5. Confirm candidates with \`get_document_content\` and return the best matches with id, title, correspondent, created date and why each matches.`),
  );

  server.registerPrompt(
    "cleanup_tags",
    {
      description:
        "Find unused or near-duplicate tags and propose merges; nothing is deleted without confirmation",
    },
    () =>
      user(`Help me clean up my Paperless tags.

1. Read the paperless://tags resource (or call \`list_tags\`) to get every tag with its document count.
2. Identify unused tags (document_count 0) and near-duplicates: case, spelling, singular/plural or language variants, and tags that duplicate a correspondent or document type.
3. Propose a plan: for each merge, the tag to keep and the tags to retire; list unused tags as deletion candidates. Never touch inbox tags (is_inbox_tag).
4. Wait for my explicit confirmation of each item. To merge, find the documents with \`list_documents\` and tags__id__all set to the old tag (it returns one page, so set page_size or page through all results), then call \`bulk_edit_documents\` with method modify_tags and parameters { add_tags: [keep], remove_tags: [old] }. Verify the old tag has no documents left.
5. Before proposing to delete a tag, check what still references it: saved view filter rules (paperless://saved-views or \`list_saved_views\`), mail rules (\`list_mail_rules\`) and workflows (\`list_workflows\`). Report those references and update them first if I agree.
6. Only call \`delete_tag\` for a tag whose deletion I confirmed. Never delete without confirmation.`),
  );
}
