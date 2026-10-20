$ErrorActionPreference='Stop'
$taskRsa=[Security.Cryptography.RSA]::Create(2048)
try {
  $taskRequest=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost',$taskRsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
  $taskSan=[Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
  $taskSan.AddDnsName('localhost')
  $taskSan.AddIpAddress([Net.IPAddress]::Parse('127.0.0.1'))
  $taskRequest.CertificateExtensions.Add($taskSan.Build())
  $taskCertificate=$taskRequest.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5),[DateTimeOffset]::UtcNow.AddDays(1))
  $taskCertificate.ExportCertificatePem() | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'localhost-cert.pem') -Encoding ascii
  $taskRsa.ExportPkcs8PrivateKeyPem() | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'localhost-key.pem') -Encoding ascii
  $taskCertificate.Dispose()
} finally { $taskRsa.Dispose() }
Write-Output 'Created short-lived localhost fixtures only. No certificate was installed in a trust store. Do not publish the generated key.'
