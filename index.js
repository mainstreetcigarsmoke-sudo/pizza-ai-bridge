const express = require('express');
const app = express();
app.use(express.json());

const {
  RESEND_API_KEY,
  PORT = 3000
} = process.env;

app.post('/create-order', async (req, res) => {
  try {
    const { name, time, items, notes, phoneNumber } = req.body.message.toolCalls[0].function.arguments;
    const toolCallId = req.body.message.toolCalls[0].id;

    const itemsList = Array.isArray(items) 
      ? items.map(i => typeof i === 'object' ? i.itemName || JSON.stringify(i) : i).join(', ')
      : items;

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

app.get('/', (req, res) => res.send('Pizza AI Bridge is running! 🍕'));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
