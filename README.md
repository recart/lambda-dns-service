# `lambda-dns`

An AWS Lambda function to maintain Route 53 DNS records from EC2 events, using
the `r53-domain-name` and `r53-zone-ids` tag on instances.

`r53-domain-name`: my-instance-3.myhostedzone.local
`r53-zone-ids`: comma separated list of Route53 zone IDs `Z14X0X86GHO32N,Z1EDHAKW9123R,Z1936S67FIY12C`

Records have a deliberately short (5-second) TTL.

The `r53-domain-name` will be set with an A record to the instance's private IPv4 address in all the zones provided in the `r53-zone-ids`.

