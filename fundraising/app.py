"""Local development UI. Authentication must be added before remote deployment."""
from datetime import date
from decimal import Decimal, InvalidOperation
from html import escape
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs
import secrets
import sqlite3

from .db import connect

TOKEN = secrets.token_urlsafe(32)


def money(value):
    amount = Decimal(value)
    if not amount.is_finite() or amount <= 0 or amount > Decimal('999999999999.99') or amount * 100 != (amount * 100).to_integral_value():
        raise ValueError('Enter a positive amount with at most two decimal places.')
    return int(amount * 100)


class Handler(BaseHTTPRequestHandler):
    def page(self, error=''):
        with connect() as db:
            org = db.execute('SELECT * FROM organizations ORDER BY id LIMIT 1').fetchone()
            content = ''
            def form(action, fields, label):
                return f'<form method="post" action="/{action}"><input type="hidden" name="token" value="{TOKEN}">{fields}<button>{label}</button></form>'
            if not org:
                content = '<section><h2>Set up your organization</h2><p>Choose your working currency. This initial version supports currencies with two decimal places.</p>' + form('setup', '<label>Organization name<input name="name" required maxlength="200"></label><label>Currency<select name="currency"><option>USD</option><option>GBP</option><option>EUR</option><option>CAD</option><option>ILS</option></select></label>', 'Create organization') + '</section>'
            else:
                donors = db.execute('SELECT * FROM donors WHERE organization_id=?', (org['id'],)).fetchall()
                campaigns = db.execute('SELECT * FROM campaigns WHERE organization_id=?', (org['id'],)).fetchall()
                pledges = db.execute('SELECT p.*, d.name donor,c.name campaign FROM pledges p JOIN donors d ON p.donor_id=d.id JOIN campaigns c ON p.campaign_id=c.id WHERE p.organization_id=? ORDER BY p.id DESC', (org['id'],)).fetchall()
                total = sum(p['amount_minor'] for p in pledges)
                content = f'<p>{escape(org["name"])} · {escape(org["currency"])}</p><div class="stats"><section><small>Total pledged</small><h2>{total / 100:,.2f}</h2></section><section><small>Donors</small><h2>{len(donors)}</h2></section><section><small>Campaigns</small><h2>{len(campaigns)}</h2></section></div>'
                content += '<div class="grid"><section><h2>Donors</h2>' + form('donors', '<label>Name<input name="name" required maxlength="200"></label><label>Email (optional)<input type="email" name="email" maxlength="254"></label>', 'Add donor')
                content += '<ul>' + ''.join(f'<li>{escape(d["name"])}</li>' for d in donors) + '</ul></section><section><h2>Campaigns</h2>' + form('campaigns', '<label>Name<input name="name" required maxlength="200"></label>', 'Add campaign')
                content += '<ul>' + ''.join(f'<li>{escape(c["name"])}</li>' for c in campaigns) + '</ul></section></div>'
                options = lambda rows: ''.join(f'<option value="{r["id"]}">{escape(r["name"])}</option>' for r in rows)
                content += '<section><h2>Record a pledge</h2><p>A pledge records a commitment; it does not charge a card or record received income.</p>'
                if donors and campaigns:
                    content += form('pledges', f'<label>Donor<select name="donor_id">{options(donors)}</select></label><label>Campaign<select name="campaign_id">{options(campaigns)}</select></label><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Due date<input name="due_date" type="date" required></label>', 'Save pledge')
                else:
                    content += '<p>Add a donor and a campaign to begin.</p>'
                content += '<table><tr><th>Donor</th><th>Campaign</th><th>Pledged</th><th>Due date</th></tr>' + ''.join(f'<tr><td>{escape(p["donor"])}</td><td>{escape(p["campaign"])}</td><td>{p["amount_minor"]/100:,.2f}</td><td>{escape(p["due_date"])}</td></tr>' for p in pledges) + '</table></section>'
        html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fundraising · Foundation</title><style>body{margin:0;background:#f5f6f4;color:#243d38;font:16px system-ui}main{max-width:1100px;margin:50px auto;padding:20px}h1{font-size:38px}section{background:white;padding:24px;border:1px solid #dce4df;border-radius:16px;margin:16px 0}.stats,.grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}label{display:block;margin:12px 0}input,select{display:block;box-sizing:border-box;padding:10px;margin-top:6px;width:100%;border:1px solid #b9cac2;border-radius:6px}button{background:#315e50;color:white;border:0;border-radius:7px;padding:12px 20px;cursor:pointer}table{width:100%;text-align:left;margin-top:24px}td,th{padding:12px 4px;border-bottom:1px solid #e4e9e5}.notice{color:#735b20}small{font-size:14px}</style><main><small>FUNDRAISING & ACCOUNTING</small><h1>A foundation for your mission.</h1><p class="notice">Local development · No authentication or live payment connections</p>' + (f'<p role="alert">{escape(error)}</p>' if error else '') + content + '</main></html>'
        data = html.encode()
        self.send_response(400 if error else 200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path != '/':
            self.send_error(404)
            return
        self.page()

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 16384:
                raise ValueError('Invalid request size.')
            data = {k: v[0].strip() for k, v in parse_qs(self.rfile.read(length).decode(), keep_blank_values=True).items()}
            if not secrets.compare_digest(data.get('token', ''), TOKEN):
                self.send_error(403)
                return
            with connect() as db:
                org = db.execute('SELECT * FROM organizations ORDER BY id LIMIT 1').fetchone()
                if self.path == '/setup' and not org:
                    if data['currency'] not in ('USD','GBP','EUR','CAD','ILS'):
                        raise ValueError('Unsupported currency.')
                    db.execute('INSERT INTO organizations(name,currency) VALUES (?,?)', (data['name'],data['currency']))
                elif org and self.path == '/donors':
                    db.execute('INSERT INTO donors(organization_id,name,email) VALUES (?,?,?)', (org['id'],data['name'],data.get('email','')))
                elif org and self.path == '/campaigns':
                    db.execute('INSERT INTO campaigns(organization_id,name) VALUES (?,?)', (org['id'],data['name']))
                elif org and self.path == '/pledges':
                    due = date.fromisoformat(data['due_date']).isoformat()
                    db.execute('INSERT INTO pledges(organization_id,donor_id,campaign_id,amount_minor,due_date) VALUES (?,?,?,?,?)', (org['id'],int(data['donor_id']),int(data['campaign_id']),money(data['amount']),due))
                else:
                    self.send_error(404)
                    return
            self.send_response(303)
            self.send_header('Location', '/')
            self.end_headers()
        except (ValueError, KeyError, InvalidOperation, sqlite3.IntegrityError):
            self.page('Unable to save. Check the required fields, amount, date, and selected records.')


if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', 8000), Handler)
    print('Development server listening on port 8000', flush=True)
    server.serve_forever()
