import { getTranslations } from 'next-intl/server';
import {
  DEFAULT_TEMPLATES,
  listAutomations,
  listTemplates,
  templateVariables,
  whatsappConnection,
} from '@rswim/domain-comms';
import { TemplateKey } from '@rswim/contracts';
import { Badge, Card, CardTitle, PageHeader } from '@rswim/ui';
import {
  ActionButton,
  ActionForm,
  CheckboxField,
  Field,
  SubmitButton,
  TextareaField,
} from '@/components/form';
import { withSession } from '@/lib/db';
import { enumLabel } from '@/lib/options';
import { metaTemplateAction } from '@/components/whatsapp/actions';
import { saveTemplateAction, setAutomationAction } from '../actions';
import { MessagesTabs } from '../tabs';

/** The words families receive, and which event sends which of them. */
export default async function TemplatesPage() {
  const t = await getTranslations('comms');
  const label = await enumLabel();
  const { templates, automations, ownNumber } = await withSession(async (tx) => ({
    templates: await listTemplates(tx),
    automations: await listAutomations(tx),
    ownNumber: (await whatsappConnection(tx))?.status === 'connected',
  }));
  return (
    <>
      <PageHeader icon="📨" title={t('tabs.templates')} />
      <MessagesTabs active="templates" />
      <Card className="mb-4">
        <CardTitle>{t('templates.automations')}</CardTitle>
        <p className="mb-2 text-sm text-ink-muted">{t('templates.automationsHint')}</p>
        <ul className="flex flex-col divide-y divide-line">
          {automations.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center gap-2 py-2"
              data-testid="automation-row"
            >
              <span className="flex-1">
                {t.has(`events.${a.eventType.replace('.', '_')}`)
                  ? t(`events.${a.eventType.replace('.', '_')}`)
                  : a.eventType}{' '}
                → {label('templateKey', a.templateKey)}
              </span>
              <Badge tone={a.enabled ? 'ok' : 'neutral'}>
                {a.enabled ? t('templates.on') : t('templates.off')}
              </Badge>
              <ActionButton
                action={setAutomationAction}
                fields={{ id: a.id, enabled: a.enabled ? 'false' : 'true' }}
                variant="ghost"
              >
                {a.enabled ? t('templates.turnOff') : t('templates.turnOn')}
              </ActionButton>
            </li>
          ))}
        </ul>
      </Card>
      <p className="mb-2 text-sm text-ink-muted">{t('templates.hint')}</p>
      <ul className="flex flex-col gap-3">
        {templates.map((tpl) => {
          const key = TemplateKey.parse(tpl.key);
          const vars = [
            ...new Set([
              ...templateVariables(DEFAULT_TEMPLATES[key].he),
              'guardian_name',
              'school_name',
            ]),
          ];
          return (
            <li key={tpl.id}>
              <Card>
                <details>
                  <summary className="min-h-tap cursor-pointer py-2">
                    <span className="font-semibold">{label('templateKey', tpl.key)}</span>{' '}
                    <span className="text-sm text-ink-muted">({tpl.locale})</span>
                    {!tpl.active ? <Badge className="ms-2">{t('templates.off')}</Badge> : null}
                    {ownNumber && tpl.metaName ? (
                      <Badge className="ms-2" tone="ok">
                        {t('templates.metaBadge')}
                      </Badge>
                    ) : null}
                  </summary>
                  <ActionForm action={saveTemplateAction}>
                    <input type="hidden" name="id" value={tpl.id} />
                    <TextareaField
                      name="body"
                      label={t('templates.body')}
                      defaultValue={tpl.body}
                      rows={4}
                      dir={tpl.locale === 'he' ? 'rtl' : 'ltr'}
                      hint={t('templates.variables', {
                        list: vars.map((v) => `{{${v}}}`).join(' '),
                      })}
                    />
                    <CheckboxField
                      name="active"
                      label={t('templates.active')}
                      defaultChecked={tpl.active}
                    />
                    <Field
                      name="ghlTemplateId"
                      label={t('templates.ghlTemplateId')}
                      hint={t('templates.ghlHint')}
                      defaultValue={tpl.ghlTemplateId ?? ''}
                      dir="ltr"
                    />
                    <SubmitButton>{t('templates.save')}</SubmitButton>
                  </ActionForm>
                  {ownNumber ? (
                    <ActionForm
                      action={metaTemplateAction}
                      className="mt-3 border-t border-line pt-3"
                      testId={`meta-template-${tpl.key}-${tpl.locale}`}
                    >
                      <p className="text-sm text-ink-muted">{t('templates.metaHint')}</p>
                      <input type="hidden" name="key" value={tpl.key} />
                      <input type="hidden" name="locale" value={tpl.locale} />
                      <Field
                        name="metaName"
                        label={t('templates.metaName')}
                        defaultValue={tpl.metaName ?? ''}
                        dir="ltr"
                      />
                      <Field
                        name="metaParams"
                        label={t('templates.metaParams')}
                        hint={t('templates.metaParamsHint', {
                          list: vars.join(', '),
                        })}
                        defaultValue={tpl.metaParams.join(', ')}
                        dir="ltr"
                      />
                      <SubmitButton variant="secondary">{t('templates.metaSave')}</SubmitButton>
                    </ActionForm>
                  ) : null}
                </details>
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}
