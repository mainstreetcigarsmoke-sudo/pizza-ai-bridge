const express = require('express');
const app = express();
app.use(express.json());

const { RESEND_API_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY, PORT = 3000 } = process.env;

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

app.post('/create-order', async (req, res) => {
  try {
    const args = req.body.message.toolCalls[0].function.arguments;
    console.log('create-order args:', JSON.stringify(args));
    const { name, time, items, notes, phoneNumber } = args;
    const toolCallId = req.body.message.toolCalls[0].id;

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
          <h2>New Order Received!</h2>
          <p><strong>Customer:</strong> ${name}</p>
          <p><strong>Phone:</strong> ${phoneNumber}</p>
          <p><strong>Items:</strong> ${itemsList}</p>
          <p><strong>Pickup Time:</strong> ${time}</p>
          <p><strong>Notes:</strong> ${notes || 'None'}</p>
        `
      })
    });

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
          result: `Welcome back ${customer.name}! Last time you ordered ${itemsList} for pickup at ${customer.last_pickup_time}. Would you like the same thing?`
        }]
      });
    } else {
      res.json({
        results: [{
          toolCallId,
          result: `new_customer`
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
