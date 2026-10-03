import { agreementGate, EDITION, etDate, type AgreementGate, type SiteState } from './rules';

export async function loadSiteState(db: D1Database): Promise<SiteState> {
  const { results } = await db.prepare('SELECT key, value FROM site_state').all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

export async function loadGate(db: D1Database, now: Date, state?: SiteState): Promise<AgreementGate> {
  const siteState = state ?? await loadSiteState(db);
  const { results } = await db.prepare('SELECT DISTINCT date FROM confirmations WHERE edition = ?')
    .bind(Number(EDITION)).all<{ date: string }>();
  return agreementGate(siteState, results.map((r) => r.date), etDate(now));
}
