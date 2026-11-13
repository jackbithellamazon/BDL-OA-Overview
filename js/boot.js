Chart.defaults.color = '#8b99ab';
Chart.defaults.borderColor = '#1c2330';
Chart.defaults.font.family = "Inter,system-ui,sans-serif";

// Set default range to last 30 days
const now = new Date();
const d30 = new Date(now);
d30.setDate(d30.getDate()-30);
rangeFrom = d30.toLocaleDateString('en-CA');
rangeTo = now.toLocaleDateString('en-CA');
document.getElementById('rangeFrom').value = rangeFrom;
document.getElementById('rangeTo').value = rangeTo;
