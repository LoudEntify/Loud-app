// GET /s/:id/calendar.ics — "Add to calendar" on the share page. Public
// read of a public show; nothing personal in the file.
import { NextResponse } from 'next/server';
import { publicShow, whoLabel } from '../../../../lib/site/publicShows';

const ics = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;');

export async function GET(_request, { params }) {
  const { show } = await publicShow(params.id);
  if (!show) return new NextResponse('Not found', { status: 404 });
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://loudentify.app';
  const start = show.slated_at; const end = show.ends_at || new Date(Date.parse(start) + (show.duration_minutes || 60) * 60000).toISOString();
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Loudentify//Show//EN', 'BEGIN:VEVENT', `UID:show-${show.id}@loudentify.app`, `DTSTAMP:${ics(Date.now())}`, `DTSTART:${ics(start)}`, `DTEND:${ics(end)}`, `SUMMARY:${esc(`${show.title || 'Live show'} · ${whoLabel(show)} on Loudentify`)}`, `DESCRIPTION:${esc(`Watch free in your browser: ${base}/show/${show.id}`)}`, `URL:${base}/show/${show.id}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return new NextResponse(body, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="loudentify-${show.id}.ics"` } });
}
