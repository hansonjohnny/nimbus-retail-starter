$response = Invoke-RestMethod -Uri 'http://localhost:3001/auth/login' -Method POST `
  -Headers @{'Content-Type'='application/json'} `
  -Body '{"email":"alice@example.com","password":"correct-horse-battery-staple"}'
$response.token
