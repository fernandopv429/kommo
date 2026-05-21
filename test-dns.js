import dns from 'dns';
dns.lookup('google.com', (err, addresses) => {
  console.log('google:', addresses);
});
