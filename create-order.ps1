$token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1YmIyNDBjOC0wZDVmLTRiOTMtYmIxOS1iMDFiYmUxNWQzMjciLCJlbWFpbCI6ImFsaWNlQGV4YW1wbGUuY29tIiwiaWF0IjoxNzc4NTUxNjA1LCJleHAiOjE3Nzg1NTUyMDV9.wJsp_76CX7laahxzcolVUPop5b99hz0cvG8yTqSR7fg"

$response = Invoke-RestMethod -Uri 'http://localhost:3004/orders' -Method POST `
    -Headers @{
    'Authorization' = "Bearer $token"
    'Content-Type'  = 'application/json'
} `
    -Body '{"items":[{"productId":"prod-001","quantity":2}]}'

$response | ConvertTo-Json
