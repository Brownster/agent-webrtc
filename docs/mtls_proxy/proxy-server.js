const express = require('express');
const https = require('https');
const fs = require('fs');
const axios = require('axios');

const PORT = process.env.PORT || 3001;

const mTLS_OPTIONS = {
  key: fs.readFileSync('/path/to/your/client-private-key.pem'),
  cert: fs.readFileSync('/path/to/your/client-certificate.pem'),
  // ca: fs.readFileSync('/path/to/your/ca.pem'),
};

const VALID_API_KEYS = {
  'customer-a-key-123': 'http://pushgateway-a.internal:9091',
  'customer-b-key-456': 'http://pushgateway-b.internal:9091',
};

const app = express();

const authenticate = (req, res, next) => {
  const apiKey = req.header('X-API-Key');
  if (!apiKey || !VALID_API_KEYS[apiKey]) {
    return res.status(401).send('Unauthorized: Invalid API Key');
  }
  req.targetPushgateway = VALID_API_KEYS[apiKey];
  next();
};

app.all('/metrics/job/:job/instance/:instance', authenticate, async (req, res) => {
  const { method, body, params } = req;
  const targetUrl = `${req.targetPushgateway}/metrics/job/${params.job}/instance/${params.instance}`;

  console.log(`Proxying ${method} request to ${targetUrl}`);

  try {
    const httpsAgent = new https.Agent(mTLS_OPTIONS);

    const response = await axios({
      method: method,
      url: targetUrl,
      data: body,
      headers: {
        'Content-Type': req.header('Content-Type'),
      },
      httpsAgent: httpsAgent,
    });

    res.status(response.status).send(response.data);
  } catch (error) {
    console.error('Error proxying request:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response ? error.response.data : 'Proxy internal error';
    res.status(status).send(message);
  }
});

app.listen(PORT, () => {
  console.log(`mTLS Proxy server running on port ${PORT}`);
});
