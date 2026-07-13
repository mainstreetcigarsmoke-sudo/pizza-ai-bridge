const express = require('express');
const PDFDocument = require('pdfkit');
const app = express();
app.use(express.json());

const {
  RESEND_API_KEY,
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  PRINTNODE_API_KEY,
  PRINTNODE_PRINTER_ID,
  PORT = 3000
} = process.env;

const STORE_OPEN_HOUR = 9;
const STORE_CLOSE_HOUR = 21;

function isStoreOpenNow() {
  const nowEastern = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const hour = new Date(nowEastern).getHours();
  return hour >= STORE_OPEN_HOUR && hour < STORE_CLOSE_HOUR;
}

const supabaseHeaders = {
  'apikey': SUPABASE_SECRET_KEY,
  'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

async function getCustomer(phone) {
  try {
    const clean = phone.replace(/\D/g, '');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/customers?phone_number=eq.${clean}&select=*`, {
      headers: supabaseHeaders
    });
    const data = await res.json();
    return data[0] || null;
  } catch (err) {
    console.error('getCustomer error:', err);
    return null;
  }
}

async function saveCustomer(phone, name, items, time) {
  try {
    const clean = phone.replace(/\D/g, '');
    const existing = await getCustomer(clean);
    if (existing) {
      await fetch(`${SUPABASE_URL}/rest/v1/customers?phone_number=eq.${clean}`, {
        method: 'PATCH',
        headers: supabaseHeaders,
        body: JSON.stringify({
          name,
          last_order: JSON.stringify(items),
          last_pickup_time: time,
          order_count: (existing.order_count || 1) + 1,
          updated_at: new Date().toISOString()
        })
      });
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/customers`, {
        method: 'POST',
        headers: supabaseHeaders,
        body: JSON.stringify({
          phone_number: clean,
          name,
          last_order: JSON.stringify(items),
          last_pickup_time: time,
          order_count: 1
        })
      });
    }
  } catch (err) {
    console.error('saveCustomer error:', err);
  }
}

function formatItems(items) {
  if (!Array.isArray(items)) return items;
  const pizzaKeywords = ['pizza', 'calzone', 'medium', 'large', 'xl', 'thin crust', 'gluten free', 'slice'];
  const grouped = [];
  let currentPizza = null;
  items.forEach(item => {
    const raw = typeof item === 'object' ? (item.itemName || JSON.stringify(item)) : item;
    const lower = raw.toLowerCase();
    const isTopping = lower.includes('topping') || lower.includes('(large') || lower.includes('(medium') || lower.includes('(xl') || lower.includes('extra ');
    const isPizza = !isTopping && pizzaKeywords.some(s => lower.includes(s));
    if (isPizza) {
      currentPizza = { name: raw, toppings: [] };
      grouped.push(currentPizza);
    } else if (isTopping && currentPizza) {
      const cleanTopping = raw.replace(/\(.*?\)/g, '').trim();
      currentPizza.toppings.push(cleanTopping);
    } else {
      grouped.push({ name: raw, toppings: [] });
      currentPizza = null;
    }
  });
  return grouped;
}

function formatItemsHTML(items) {
  const grouped = formatItems(items);
  if (typeof grouped === 'string') return `<li>${grouped}</li>`;
  return grouped.map(item => {
    let html = `<li style="margin-bottom:6px"><strong>${item.name}</strong>`;
    if (item.toppings.length > 0) {
      html += '<ul style="margin:4px 0 0 16px;padding:0;list-style:none">';
      html += item.toppings.map(t => `<li style="color:#555;font-size:13px">+ ${t}</li>`).join('');
      html += '</ul>';
    }
    html += '</li>';
    return html;
  }).join('');
}

function formatItemsFlat(items) {
  const grouped = formatItems(items);
  if (typeof grouped === 'string') return grouped;
  return grouped.map(item => {
    let parts = [item.name];
    if (item.toppings.length > 0) parts.push(item.toppings.join(', '));
    return parts.join(' + ');
  }).join(' | ');
}

function buildTicketPDF({ name, phoneNumber, items, time, notes }) {
  return new Promise((resolve, reject) => {
    try {
     const doc = new PDFDocument({ size: 'letter', margin: 50 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.fontSize(16).text("SAL'S PIZZA - NEW ORDER", { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(11).text(`Customer: ${name}`);
      doc.text(`Phone: ${phoneNumber}`);
      doc.text(`Pickup: ${time}`);
      doc.moveDown(0.5);
      doc.fontSize(12).text('ORDER ITEMS:', { underline: true });
      doc.moveDown(0.3);
      const grouped = formatItems(items);
      if (typeof grouped === 'string') {
        doc.fontSize(11).text(grouped);
      } else {
        grouped.forEach(item => {
          doc.fontSize(11).text(`• ${item.name}`);
          item.toppings.forEach(t => {
            doc.fontSize(10).text(`    + ${t}`);
          });
        });
      }
      doc.moveDown(0.5);
      if (notes) doc.fontSize(10).text(`Notes: ${notes}`);
      doc.moveDown(0.5);
      doc.fontSize(9).text(new Date().toLocaleString(), { align: 'center' });
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function printOrderTicket(order) {
  try {
    if (!PRINTNODE_API_KEY || !PRINTNODE_PRINTER_ID) {
      console.log('PrintNode not configured, skipping print.');
      return;
    }
    const pdfBuffer = await buildTicketPDF(order);
    const base64PDF = pdfBuffer.toString('base64');
    const authHeader = 'Basic ' + Buffer.from(`${PRINTNODE_API_KEY}:`).toString('base64');
    const res = await fetch('https://api.printnode.com/printjobs', {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        printerId: Number(PRINTNODE_PRINTER_ID),
        title: `Order - ${order.name}`,
        contentType: 'pdf_base64',
        content: base64PDF,
        source: 'Pizza AI Bridge'
      })
    });
    const result = await res.text();
    console.log('PrintNode response:', res.status, result);
  } catch (err) {
    console.error('printOrderTicket error:', err);
  }
}

app.post('/create-order', async (req, res) => {
  try {
    const args = req.body.message.toolCalls[0].function.arguments;
    const { name, time, items, notes, phoneNumber } = args;
    const toolCallId = req.body.message.toolCalls[0].id;

    if (!isStoreOpenNow()) {
      return res.json({
        results: [{ toolCallId, result: `Sorry, Sal's Pizza is currently closed. We're open daily from 9 AM to 9 PM Eastern. Please call back during business hours!` }]
      });
    }

    const itemsHTML = formatItemsHTML(items);
    const itemsFlat = formatItemsFlat(items);

    await saveCustomer(phoneNumber, name, items, time);

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'orders@resend.dev',
        to: 'mainstreetcigarsmoke@gmail.com',
        subject: `🍕 New Order from ${name} — Pickup ${time}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;border:1px solid #ddd;border-radius:8px;overflow:hidden">
            <div style="background:#E84C2B;padding:16px;text-align:center">
              <h2 style="color:white;margin:0;font-size:18px">🍕 NEW ORDER — SAL'S PIZZA</h2>
            </div>
            <div style="padding:16px;background:#fff">
              <table style="width:100%;font-size:14px;border-collapse:collapse">
                <tr><td style="padding:6px 0;color:#888;width:100px">Customer</td><td style="padding:6px 0;font-weight:bold">${name}</td></tr>
                <tr><td style="padding:6px 0;color:#888">Phone</td><td style="padding:6px 0">${phoneNumber}</td></tr>
                <tr><td style="padding:6px 0;color:#888">Pickup</td><td style="padding:6px 0;font-weight:bold;color:#E84C2B">${time}</td></tr>
              </table>
              <hr style="border:none;border-top:1px solid #eee;margin:12px 0">
              <p style="font-size:13px;font-weight:bold;color:#333;margin:0 0 8px">ORDER ITEMS</p>
              <ul style="margin:0;padding-left:16px;font-size:14px;line-height:1.8">
                ${itemsHTML}
              </ul>
              ${notes ? `<hr style="border:none;border-top:1px solid #eee;margin:12px 0"><p style="font-size:13px;color:#888;margin:0">Notes: <span style="color:#333">${notes}</span></p>` : ''}
            </div>
            <div style="background:#f9f9f9;padding:10px;text-align:center;font-size:12px;color:#aaa">
              Order received at ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}
            </div>
          </div>
        `
      })
    });

    await printOrderTicket({ name, phoneNumber, items, time, notes });

    res.json({
      results: [{ toolCallId, result: `Order confirmed! ${name}, your order is placed for pickup at ${time}. See you soon! 🍕` }]
    });
  } catch (err) {
    console.error('create-order error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/get-customer', async (req, res) => {
  try {
    const args = req.body.message.toolCalls[0].function.arguments;
    const { phoneNumber } = args;
    const toolCallId = req.body.message.toolCalls[0].id;
    const customer = await getCustomer(phoneNumber);
    if (customer) {
      const items = JSON.parse(customer.last_order || '[]');
      const itemsFlat = formatItemsFlat(items);
      res.json({ results: [{ toolCallId, result: `Welcome back ${customer.name}! Last time you ordered ${itemsFlat} for pickup at ${customer.last_pickup_time}. Would you like the same thing?` }] });
    } else {
      res.json({ results: [{ toolCallId, result: `new_customer` }] });
    }
  } catch (err) {
    console.error('get-customer error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.send('Pizza AI Bridge is running! 🍕'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
