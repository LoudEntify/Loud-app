// lib/countries.js
// ─────────────────────────────────────────────────────────────
// Country list for the signup form.
//
// Stores/round-trips the ISO 3166-1 alpha-2 CODE, never the label. Two
// reasons: display names change (and differ by locale) while codes do
// not, and a two-letter column is trivially joinable against any future
// payouts/tax/region logic. The human-readable label is derived at
// render time from Intl.DisplayNames, which every browser we target
// ships -- so there is no 250-line name table in this repo to drift out
// of date.
//
// Falls back to the raw code if Intl.DisplayNames is unavailable, which
// is ugly but never blank.
// ─────────────────────────────────────────────────────────────

export const COUNTRY_CODES = [
  'AF','AX','AL','DZ','AS','AD','AO','AI','AQ','AG','AR','AM','AW','AU','AT','AZ',
  'BS','BH','BD','BB','BY','BE','BZ','BJ','BM','BT','BO','BQ','BA','BW','BV','BR',
  'IO','BN','BG','BF','BI','CV','KH','CM','CA','KY','CF','TD','CL','CN','CX','CC',
  'CO','KM','CG','CD','CK','CR','CI','HR','CU','CW','CY','CZ','DK','DJ','DM','DO',
  'EC','EG','SV','GQ','ER','EE','SZ','ET','FK','FO','FJ','FI','FR','GF','PF','TF',
  'GA','GM','GE','DE','GH','GI','GR','GL','GD','GP','GU','GT','GG','GN','GW','GY',
  'HT','HM','VA','HN','HK','HU','IS','IN','ID','IR','IQ','IE','IM','IL','IT','JM',
  'JP','JE','JO','KZ','KE','KI','KP','KR','KW','KG','LA','LV','LB','LS','LR','LY',
  'LI','LT','LU','MO','MG','MW','MY','MV','ML','MT','MH','MQ','MR','MU','YT','MX',
  'FM','MD','MC','MN','ME','MS','MA','MZ','MM','NA','NR','NP','NL','NC','NZ','NI',
  'NE','NG','NU','NF','MK','MP','NO','OM','PK','PW','PS','PA','PG','PY','PE','PH',
  'PN','PL','PT','PR','QA','RE','RO','RU','RW','BL','SH','KN','LC','MF','PM','VC',
  'WS','SM','ST','SA','SN','RS','SC','SL','SG','SX','SK','SI','SB','SO','ZA','GS',
  'SS','ES','LK','SD','SR','SJ','SE','CH','SY','TW','TJ','TZ','TH','TL','TG','TK',
  'TO','TT','TN','TR','TM','TC','TV','UG','UA','AE','GB','US','UM','UY','UZ','VU',
  'VE','VN','VG','VI','WF','EH','YE','ZM','ZW',
];

let displayNames = null;
function getDisplayNames() {
  if (displayNames !== null) return displayNames;
  try {
    displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    displayNames = false; // cached negative -- don't retry per render
  }
  return displayNames;
}

export function countryName(code) {
  if (!code) return '';
  const dn = getDisplayNames();
  if (!dn) return code;
  try {
    return dn.of(code) || code;
  } catch {
    return code;
  }
}

/** Alphabetised {code,name} list for a <select>. */
export function countryOptions() {
  return COUNTRY_CODES
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
