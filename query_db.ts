async function main() {
  const res = await fetch('http://localhost:3000/api/connections');
  if (res.ok) {
    const data = await res.json();
    console.log("Connections length:", data.length);
  } else {
    console.error("Connections error:", await res.text());
  }
}
main().catch(console.error);
