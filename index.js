const express = require('express');
const app = express();
app.use(express.json());

const { RESEND_API_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY, PORT = 3000 } = process.env;

async function getCustomer(phone) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/customers?phone_number=eq.${phone}&select=*`, {
    headers: {
      'apikey': SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`
    }
  });
  const data = await res.json();
  return data[0] || null;
}

async function saveCustomer(phone, name, items, time) {
  const existing = await getCustomer(phone);
  if (existing) {
    await fetch(`${SUPABASE_URL}/rest/v1/customers?phone_number=eq.${phone}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SECRET_KEY,
        'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
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
      headers: {
        'apikey': SUPABASE_SECRET_KEY,
        'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone_number: phone,
        name,
        last_order: JSON.stringify(items),
        last_pickup_time: time,
        order_count: 1
      })
    });
  }
}

app.post('/create-order', async (req, res) => {
  try {
    const { name, time, items, notes, phoneNumber } = req.body.message.toolCalls[0].function.arguments;
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
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/get-customer', async (req, res) => {
  try {
    const { phoneNumber } = req.body.message.toolCalls[0].function.arguments;
    const toolCallId = req.body.message.toolCalls[0].id;
    const customer = await getCustomer(phoneNumber);

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
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.send('Pizza AI Bridge is running! 🍕'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
