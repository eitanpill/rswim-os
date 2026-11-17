'use server';

/**
 * Importing a file from the previous system (SaaS stage 5), for a swim school (/admin/import) and a freediving club
 * (/dive/import): upload or link, check the columns, preview, save, take back within a day, and ask imported families
 * to sign a new standing order.
 */
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { IMPORT_KINDS_BY_VERTICAL, IMPORT_MAX_BYTES, ImportKind } from '@rswim/contracts';
import { DomainError, toDomainError } from '@rswim/domain-core';
import {
  CommitInput,
  commitImport,
  createImportDraft,
  discardImport,
  fetchSheet,
  MappingInput,
  readTable,
  requestMandates,
  saveMapping,
  undoImport,
  type Table,
} from '@rswim/domain-imports';
import { chosenFile } from './dive-files';
import type { FormState } from './form-state';
import { runForm } from './forms';
import { suggestMapping } from './imports';
import { requestOrigin } from './payments';
import { getSession } from './auth/session';

const Base = z.enum(['/admin/import', '/dive/import']);
const base = (fd: FormData) => Base.catch('/admin/import').parse(fd.get('base'));

/** Reads the upload (a file or a Google Sheets link) before any database work, so a slow download holds no lock. */
async function readSource(fd: FormData): Promise<{ table: Table; fileName: string }> {
  const file = chosenFile(fd, 'file');
  const link = String(fd.get('sheetUrl') ?? '').trim();
  if (file) {
    if (file.size > IMPORT_MAX_BYTES) throw new DomainError('imports.errors.tooLarge');
    return {
      table: await readTable(file.name, new Uint8Array(await file.arrayBuffer())),
      fileName: file.name,
    };
  }
  if (link) return { table: await fetchSheet(link), fileName: 'Google Sheets' };
  throw new DomainError('imports.errors.noFile');
}

export async function uploadImportAction(_: FormState, fd: FormData): Promise<FormState> {
  const t = await getTranslations();
  const session = await getSession();
  const kinds: readonly string[] = IMPORT_KINDS_BY_VERTICAL[session?.vertical ?? 'swim'];
  const kind = ImportKind.safeParse(fd.get('kind'));
  if (!kind.success || !kinds.includes(kind.data)) {
    return {
      ok: false,
      errors: { kind: t('forms.errors.invalid') },
      message: t('forms.fixErrors'),
    };
  }
  let source: { table: Table; fileName: string };
  try {
    source = await readSource(fd);
  } catch (e) {
    const de = toDomainError(e);
    if (!de) throw e;
    return { ok: false, errors: {}, message: t(de.code, de.params) };
  }
  const mapping = await suggestMapping(kind.data, source.table);
  const to = base(fd);
  return runForm(
    fd,
    z.object({}),
    (tx, ctx) => createImportDraft(tx, ctx, { kind: kind.data, ...source, mapping }),
    { redirectTo: (id) => `${to}/${id}` },
  );
}

export async function saveMappingAction(_: FormState, fd: FormData) {
  const to = base(fd);
  return runForm(fd, MappingInput, (tx, _ctx, input) => saveMapping(tx, input), {
    // The form is drawn again from the saved mapping (and the preview below it), which is the confirmation.
    revalidate: `${to}/${String(fd.get('importId'))}`,
  });
}

export async function discardImportAction(_: FormState, fd: FormData) {
  const to = base(fd);
  return runForm(
    fd,
    z.object({ importId: z.uuid() }),
    (tx, _ctx, { importId }) => discardImport(tx, importId),
    { redirectTo: () => to },
  );
}

export async function commitImportAction(_: FormState, fd: FormData) {
  const to = base(fd);
  const t = await getTranslations('imports');
  return runForm(
    fd,
    CommitInput,
    (tx, ctx, input) => commitImport(tx, ctx, input, { balanceDescription: t('balanceEntry') }),
    { revalidate: [to, `${to}/${String(fd.get('importId'))}`], success: 'imports.saved' },
  );
}

export async function undoImportAction(_: FormState, fd: FormData) {
  const to = base(fd);
  return runForm(
    fd,
    z.object({ importId: z.uuid() }),
    (tx, _ctx, { importId }) => undoImport(tx, importId),
    {
      revalidate: [to, `${to}/${String(fd.get('importId'))}`],
      success: (r, tr) => tr('imports.undone', { removed: r.removed, kept: r.kept }),
    },
  );
}

export async function requestMandatesAction(_: FormState, fd: FormData) {
  const to = base(fd);
  const t = await getTranslations('imports');
  const publicUrl = await requestOrigin();
  return runForm(
    fd,
    z.object({ importId: z.uuid() }),
    async (tx, ctx, { importId }) => {
      try {
        return await requestMandates(tx, ctx, {
          importId,
          publicUrl,
          description: t('mandateDescription'),
        });
      } catch (e) {
        // The processor message is written for a paying customer; the owner needs to hear what to connect.
        if (toDomainError(e)?.code === 'payments.errors.notConnected') {
          throw new DomainError('imports.errors.noProcessor');
        }
        throw e;
      }
    },
    {
      revalidate: `${to}/${String(fd.get('importId'))}`,
      success: (n, tr) => tr('imports.mandates.sent', { count: n }),
    },
  );
}
