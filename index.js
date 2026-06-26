const express = require('express');
const app = express();
app.use(express.json());

const {
  TOAST_CLIENT_ID,
  TOAST_CLIENT_SECRET,
  TOAST_API_HOSTNAME,
  TOAST_USER_ACCESS_TYPE,
  PORT = 3000
} = process.env;

async function getToastToken() {
  const res = await fetch(`${TOAST_API_HOSTNAME}/authentication/v1/authentication/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: TOAST_CLIENT_ID,
      clientSecret: TOAST_CLIENT_SECRET,
      userAccessType: TOAST_USER_ACCESS_TYPE
    })
  });
  const data = await res.json();
  return data.token.accessToken;
}

app.post('/create-order', async (req, res) => {
  try {
    const { customerName, phone, items, orderType } = req.body;
    const token = await getToastToken();
    res.json({ success: true, message: `Order received for ${customerName}`, items, orderType });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => res.send('Pizza AI Bridge is running! 🍕'));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
