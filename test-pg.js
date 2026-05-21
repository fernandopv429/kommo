import net from 'net';
const client = new net.Socket();
client.connect(5432, '127.0.0.1', () => {
    console.log('Connected');
    client.destroy();
});
client.on('error', (err) => {
    console.error('Error:', err);
});
