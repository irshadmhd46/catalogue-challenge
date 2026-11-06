## ADDED Requirements

### Requirement: Mail, rate limit and proxy settings are configured and validated

Configuration SHALL include these settings with the defaults shown.

| Variable                       | Default (not production)     | Rule                                              |
| ------------------------------ | ---------------------------- | ------------------------------------------------- |
| `NOTIFIER_DRIVER`              | `smtp`                       | one of `smtp`                                     |
| `SMTP_HOST`                    | `localhost`                  | non-empty host name; explicit in production       |
| `SMTP_PORT`                    | 1025                         | integer 1 to 65535                                |
| `SMTP_TLS`                     | `none`                       | `none`, `starttls` or `tls`; not `none` in production |
| `SMTP_USER`, `SMTP_PASSWORD`   | unset                        | both set or both unset                            |
| `SMTP_TIMEOUT_MS`              | 8000                         | integer 1 to 60000                                |
| `MAIL_FROM`                    | `no-reply@catalogue.local`   | plain email address; explicit in production       |
| `SALES_INBOX`                  | `sales@catalogue.local`      | plain email address; explicit in production       |
| `RATE_LIMIT_ENQUIRY_PER_MINUTE`| 5                            | integer 1 to 1000                                 |
| `RATE_LIMIT_READ_PER_MINUTE`   | 120                          | integer 1 to 100000                               |
| `TRUST_PROXY_HOPS`             | 0                            | integer 0 to 5                                    |

#### Scenario: Defaults

- **WHEN** configuration is loaded from an empty environment
- **THEN** the mail settings point at a local Mailpit with the default addresses, the limits are 5
  and 120 per minute and `trustProxyHops` is 0

#### Scenario: Explicit values

- **WHEN** all of the settings are provided with valid values
- **THEN** they are read as numbers and strings as appropriate

#### Scenario: Production requires explicit mail settings

- **WHEN** `NODE_ENV=production` and any of `SMTP_HOST`, `MAIL_FROM` or `SALES_INBOX` is missing
- **THEN** a `ConfigError` names each missing variable

#### Scenario: Production requires TLS

- **WHEN** `NODE_ENV=production` and `SMTP_TLS` is `none` or unset
- **THEN** a `ConfigError` names `SMTP_TLS`
- **AND** `starttls` and `tls` are accepted

#### Scenario: Credentials come as a pair

- **WHEN** only `SMTP_USER` or only `SMTP_PASSWORD` is set
- **THEN** a `ConfigError` names the missing one

#### Scenario: Addresses must be plain addresses

- **WHEN** `MAIL_FROM` or `SALES_INBOX` is `Name <a@b.co>`, `a@b.co, c@d.co`, `not an email` or
  contains a line break
- **THEN** a `ConfigError` names that variable

#### Scenario: Bounds

- **WHEN** `SMTP_PORT=0`, `SMTP_TIMEOUT_MS=0`, `RATE_LIMIT_ENQUIRY_PER_MINUTE=0` or
  `TRUST_PROXY_HOPS=6` is set
- **THEN** a `ConfigError` names that variable

#### Scenario: Secrets and addresses are not echoed

- **WHEN** configuration fails with `SMTP_PASSWORD=hunter2` and an invalid `SALES_INBOX`
- **THEN** the error message and details contain neither `hunter2` nor the offending address

### Requirement: Startup summary shows only non-secret mail fields

The startup `info` summary SHALL add `notifierDriver` and `smtpHost` and SHALL NOT contain the
password, the user, or the sender and sales addresses.

#### Scenario: Summary fields

- **WHEN** the summary is built with credentials configured
- **THEN** it contains `notifierDriver` and `smtpHost`
- **AND** its serialised form contains none of the user, password, sender or sales inbox
