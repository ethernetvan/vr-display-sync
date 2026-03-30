# Script to Run The Program Locally on Windows


choco install mkcert


$ip_address = (Get-NetIPAddress -AddressFamily IPv4).IPAddress

#missing cert gen step

$env:SSL_KEY="config/YOUR_IP_HERE-key.pem"; $env:SSL_CERT="config/YOUR_IP_HERE.pem"; np