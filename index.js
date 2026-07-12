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

// Store hours: 9:00 AM - 9:00 PM Eastern Time
const STORE_OPEN_HOUR = 9;   // 9 AM
const STORE_CLOSE_HOUR = 21; // 9 PM (24hr format)

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
    console.log('getCustomer result:', JSON.stringify(data));
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
      const res = await fetch(`${SUPABASE_URL}/rest/v1/customers?phone_number=eq.${clean}`, {
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
      console.log('updateCustomer status:', res.status);
    } else {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/customers`, {
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
      console.log('saveCustomer status:', res.status);
      const data = await res.json();
      console.log('saveCustomer response:', JSON.stringify(data));
    }
  } catch (err) {
    console.error('saveCustomer error:', err);
  }
}

function buildTicketPDF({ name, phoneNumber, itemsList, time, notes }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: [288, 500], margin: 10 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(16).text("SAL'S PIZZA - NEW ORDER", { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Name: ${name}`);
      doc.text(`Phone: ${phoneNumber}`);
      doc.text(`Pickup Time: ${time}`);
      doc.moveDown();
      doc.fontSize(12).text('Items:', { underline: true });
      doc.fontSize(12).text(itemsList);
      doc.moveDown();
      doc.text(`Notes: ${notes || 'None'}`);
      doc.moveDown();
      doc.fontSize(10).text(new Date().toLocaleString(), { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function printOrderTicket(order) {
  try {
    if (!PRINTNODE_API_KEY || !PRINTNODE_PRINTER_ID) {
      console.log('PrintNode not configured yet, skipping print.');
      return;
    }

    const pdfBuffer = await buildTicketPDF(order);
    const base64PDF = pdfBuffer.toString('base64');

    const authHeader = 'Basic ' + Buffer.from(`${PRINTNODE_API_KEY}:`).toString('base64');

    const res = await fetch('https://api.printnode.com/printjobs', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
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
    console.log('create-order args:', JSON.stringify(args));
    const { name, time, items, notes, phoneNumber } = args;
    const toolCallId = req.body.message.toolCalls[0].id;

    if (!isStoreOpenNow()) {
      return res.json({
        results: [{
          toolCallId,
          result: `Sorry, Sal's Pizza is currently closed. We're open daily from 9 AM to 9 PM Eastern. Please call back during business hours!`
        }]
      });
    }

    const itemsList = Array.isArray(items)
      ? items.map(i => typeof i === 'object' ? i.itemName || JSON.stringify(i) : i).join(', ')
      : items;

    await saveCustomer(phoneNumber, name, items, time);

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'orders@resend.dev',
        to: 'mainstreetcigarsmoke@gmail.com',
        subject: `🍕 New Pizza Order from ${name}!`,
       html: `
  <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto">
    <div style="background:#D32F2F;padding:15px;text-align:center">
      <h2 style="color:white;margin:0">🍕 NEW ORDER — SAL'S PIZZA</h2>
    </div>
    <div style="padding:20px;background:#f9f9f9">
      
      <table style="width:100%;border-collapse:collapse;margin-bottom:15px">
        <tr style="background:#333;color:white">
          <td style="padding:8px"><b>👤 Customer</b></td>
          <td style="padding:8px">${name}</td>
        </tr>
        <tr style="background:#fff">
          <td style="padding:8px"><b>📞 Phone</b></td>
          <td style="padding:8px">${phoneNumber}</td>
        </tr>
        <tr style="background:#f5f5f5">
          <td style="padding:8px"><b>⏰ Pickup Time</b></td>
          <td style="padding:8px">${time}</td>
        </tr>
      </table>

      <div style="background:white;border:2px solid #D32F2F;border-radius:8px;padding:15px;margin-bottom:15px">
        <h3 style="color:#D32F2F;margin:0 0 10px 0">🛒 ORDER ITEMS</h3>
        ${Array.isArray(items) ? items.map(i => {
          const itemName = typeof i === 'object' ? (i.itemName || i.name || JSON.stringify(i)) : i;
          const qty = typeof i === 'object' ? (i.quantity || 1) : 1;
          const price = typeof i === 'object' && i.basePriceMoney ? 
            '$' + (i.basePriceMoney.amount / 100).toFixed(2) : '';
          return `<div style="padding:8px 0;border-bottom:1px solid #eee">
            <b>✅ ${qty}x ${itemName}</b> ${price}
          </div>`;
        }).join('') : `<div style="padding:8px 0">${itemsList}</div>`}
      </div>

      ${notes ? `
      <div style="background:#FFF8E1;border-left:4px solid #FFC107;padding:10px;margin-bottom:15px">
        <b>📝 Special Notes:</b> ${notes}
      </div>` : ''}

      <div style="background:#E8F5E9;border-left:4px solid #4CAF50;padding:10px;text-align:center">
        <b style="color:#2E7D32">✅ Order confirmed and saved to database!</b>
      </div>
      
      <p style="color:#999;font-size:11px;text-align:center;margin-top:15px">
        ${new Date().toLocaleString('en-US', {timeZone:'America/New_York'})} ET
      </p>
    </div>
  </div>
`
        `
      })
    });

    await printOrderTicket({ name, phoneNumber, itemsList, time, notes });

    res.json({
      results: [{
        toolCallId,
        result: `Order confirmed! ${name}, your order of ${itemsList} is placed for ${time}. See you soon! 🍕`
      }]
    });
  } catch (err) {
    console.error('create-order error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/get-customer', async (req, res) => {
  try {
    const args = req.body.message.toolCalls[0].function.arguments;
    console.log('get-customer args:', JSON.stringify(args));
    const { phoneNumber } = args;
    const toolCallId = req.body.message.toolCalls[0].id;
    const customer = await getCustomer(phoneNumber);
    console.log('customer found:', JSON.stringify(customer));

    if (customer) {
      const items = JSON.parse(customer.last_order || '[]');
      const itemsList = Array.isArray(items)
        ? items.map(i => typeof i === 'object' ? i.itemName || JSON.stringify(i) : i).join(', ')
        : items;
      res.json({
        results: [{
          toolCallId,
          result: `RETURNING CUSTOMER FOUND! STOP! Do NOT ask for their name! Do NOT say "Can I get your name?". 
The customer's name is: ${customer.name}
Their last order was: ${itemsList}
Their last pickup time was: ${customer.last_pickup_time}
You MUST immediately say: "Welcome back ${customer.name}! Last time you ordered ${itemsList} for pickup at ${customer.last_pickup_time}. Would you like the same thing again?"`
        }]
      });
    } else {
      res.json({
        results: [{
          toolCallId,
          result: `NEW CUSTOMER - not in database. Ask for their name politely and take their order normally.`
        }]
      });
    }
  } catch (err) {
    console.error('get-customer error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.send('Pizza AI Bridge is running! 🍕'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
