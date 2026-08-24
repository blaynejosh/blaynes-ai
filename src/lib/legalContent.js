/**
 * Markdown source for the legal / policy surfaces: the Advanced AI Model
 * Safety Addendum (blocking gate, shown once per account) and the public
 * Terms of Use / Privacy Policy pages. Kept out of the components so the
 * text can be revised — including by counsel — without touching layout code.
 *
 * IMPORTANT: this copy is a starting draft, not a substitute for review by
 * a qualified attorney licensed in Blayne's Consulting's operating
 * jurisdiction(s). Bracketed placeholders (e.g. governing-law entity/venue)
 * must be filled in before this is relied on in production.
 */

export const LAST_UPDATED = 'August 21, 2026';

export const SAFETY_ADDENDUM_MD = `
This Advanced AI Model Safety Addendum ("**Addendum**") supplements the [Terms of Use](/terms) between you and Blayne's Consulting ("**Blayne's**", "**we**", "**us**") and governs your use of B.L.A.Y.N.E's AI-powered features. It applies to every session that uses the advanced AI models powering B.L.A.Y.N.E's consulting outputs ("**Covered Models**"). You must read and accept this Addendum before your account can access the rest of the platform, and every account accepts it once, at first use.

### 1. Why this exists

The Covered Models are general-purpose large language models capable of producing fluent, confident-sounding text on almost any topic — including topics where they can be wrong. Before you rely on B.L.A.Y.N.E for anything that affects a real business decision, you should understand what the models can and cannot responsibly be used for, and what we do to keep the platform safe.

### 2. Model capabilities and limitations

- **Outputs can be inaccurate.** The Covered Models can produce statements that are plausible but false ("hallucinations"), including fabricated statistics, citations, case law, regulatory references, and quotes. B.L.A.Y.N.E does not independently verify model output against external sources unless a specific skill explicitly performs that check.
- **Outputs reflect training data, not real-time truth.** Model knowledge has a cutoff and does not automatically reflect events, prices, regulations, or market conditions after that date.
- **Outputs are not professional advice.** Nothing produced by B.L.A.Y.N.E constitutes legal, tax, accounting, financial, investment, medical, or other licensed professional advice, even when phrased in that register. Engage a qualified, licensed professional for decisions in those domains.
- **You are responsible for verification.** You must independently review, fact-check, and exercise your own judgment on any AI-generated output before using it, publishing it, sending it to a client, or acting on it — particularly for figures, legal or regulatory claims, and anything with financial, contractual, or reputational consequences.

### 3. Prohibited and restricted uses

In addition to the acceptable-use terms in the [Terms of Use](/terms), you agree not to use B.L.A.Y.N.E's Covered Models to:

1. Generate content intended to deceive, defraud, or impersonate a real person or organization without disclosure that the content is AI-generated.
2. Make or materially inform a fully automated decision about an individual's employment, credit, housing, insurance, healthcare, or legal rights without meaningful human review.
3. Generate disinformation, election-related manipulation content, or coordinated inauthentic messaging.
4. Develop, model, or provide instructions for weapons (including chemical, biological, radiological, nuclear, or explosive), malicious code, or other tools intended to cause physical, financial, or infrastructural harm.
5. Generate content that sexualizes minors, facilitates child exploitation, or violates any applicable child-safety law, in any circumstance.
6. Conduct biometric surveillance, social scoring, or covert profiling of individuals without their knowledge and a lawful basis.
7. Present AI output as independently verified fact in a regulated filing, court submission, medical record, or safety-critical system without the human review and sign-off those contexts require.
8. Attempt to circumvent B.L.A.Y.N.E's safety filters, rate limits, or monitoring, or use the platform to test, probe, or degrade the safety properties of the Covered Models.

This list is illustrative, not exhaustive, and is applied alongside our AI model provider's own usage policy, which governs the underlying models and which Blayne's Consulting has agreed to enforce as a condition of access.

### 4. Human oversight for high-stakes use

If you use B.L.A.Y.N.E to support a decision with material legal, financial, safety, or employment consequences, a qualified human must review the output and take responsibility for the final decision before it is acted on. B.L.A.Y.N.E is a drafting and analysis aid, not an autonomous decision-maker, and no output should be treated as final without that review.

### 5. Monitoring, logging, and safety review

To keep the platform safe and improve it, we log conversation metadata and, in a limited set of circumstances (suspected abuse, a safety report, or a legal obligation), the content of specific sessions may be reviewed by authorized Blayne's Consulting personnel or, as required, referred to our AI model provider under its own safety-review obligations. This is separate from, and narrower than, our general data-handling practices described in the [Privacy Policy](/privacy). We do not use your conversations to train models operated by Blayne's Consulting; our AI model provider's own data-use terms govern any handling on their side.

### 6. Reporting a safety concern

If a model output concerns you — a harmful suggestion, a dangerous inaccuracy, or output you believe violates this Addendum — report it to **[team@blaynes.consulting](mailto:team@blaynes.consulting)** with the session details. We investigate safety reports and may suspend access pending review.

### 7. Changes to this Addendum

We may update this Addendum as the Covered Models change or as our safety practices evolve. Material changes will be presented for re-acceptance the next time you sign in. Continued use after a non-material update constitutes acceptance of the revised Addendum.

### 8. Acceptance

By clicking "I have read and accept," you confirm that you have read this Addendum, that you understand the Covered Models' limitations described above, and that you agree to the prohibited-use and human-oversight terms in Sections 3 and 4. Acceptance is recorded against your account, with a timestamp, and applies to all future sessions unless we present a materially revised version to you again.
`.trim();

export const TERMS_OF_USE_MD = `
_Last updated: ${LAST_UPDATED}_

These Terms of Use ("**Terms**") are a binding agreement between you and Blayne's Consulting ("**Blayne's**," "**we**," "**us**," or "**our**") governing your access to and use of B.L.A.Y.N.E, our AI-powered consulting platform, including our website, application, and API-backed chat product (collectively, the "**Service**"). By creating an account, accessing, or using the Service, you agree to these Terms. If you are using the Service on behalf of an organization, you represent that you have authority to bind that organization, and "you" refers to both you and it.

If you do not agree to these Terms, do not use the Service.

### 1. Eligibility

You must be at least 18 years old, or the age of legal majority in your jurisdiction if higher, and capable of forming a binding contract, to use the Service. The Service is intended for business and professional use; it is not directed at children, and we do not knowingly permit anyone under 18 to create an account.

### 2. The Service

B.L.A.Y.N.E provides AI-assisted business consulting outputs — research, drafting, frameworks, and analysis — generated using advanced, third-party AI models. Use of these models is additionally governed by the **[Advanced AI Model Safety Addendum](/safety-addendum)**, which every account must accept before using the Service, and which is incorporated into these Terms by reference.

The Service may be offered during a beta period with usage limits (for example, a daily message quota), incomplete features, and no uptime guarantee. We may modify, suspend, or discontinue any part of the Service, including during beta, at any time.

### 3. Accounts

You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account. Notify us immediately at **[team@blaynes.consulting](mailto:team@blaynes.consulting)** of any unauthorized use. We may suspend or terminate accounts that provide false registration information or violate these Terms.

### 4. Acceptable use

You agree not to:

- Use the Service for any unlawful purpose or in violation of any applicable local, national, or international law or regulation;
- Violate the prohibited-use terms of the Advanced AI Model Safety Addendum;
- Reverse-engineer, decompile, scrape, or attempt to extract the underlying models, source code, or non-public parts of the Service;
- Use the Service to build a competing product or to train a competing AI model;
- Upload content you do not have the right to share, including another party's confidential information, or content that infringes a third party's intellectual property, privacy, or other rights;
- Interfere with or disrupt the integrity or performance of the Service, including by circumventing rate limits, probing for vulnerabilities without authorization, or introducing malware;
- Misrepresent your identity or affiliation, or impersonate any person or entity.

We may suspend or terminate your access, with or without notice, for a violation of this Section.

### 5. Your content and outputs

- **Inputs.** You retain ownership of the materials, data, and prompts you submit to the Service ("**Inputs**"). You grant Blayne's Consulting a limited license to process Inputs solely to provide, secure, and improve the Service, as described in the [Privacy Policy](/privacy).
- **Outputs.** Subject to your compliance with these Terms, you may use the content the Service generates in response to your Inputs ("**Outputs**") for your own business purposes. Because Outputs are AI-generated, similar or identical Outputs may be produced for other users from similar prompts, and we make no representation that any Output is unique or eligible for intellectual-property protection in every jurisdiction. You are responsible for reviewing Outputs — including for accuracy, appropriateness, and third-party rights — before you rely on or distribute them, consistent with Section 4 of the Safety Addendum.
- **Feedback.** If you send us feedback or suggestions about the Service, you grant us the right to use them without restriction or compensation to you.

### 6. Fees

Where a paid tier applies, fees and billing terms will be presented at the point of purchase and are incorporated into these Terms. Beta access, where offered at no charge, may be limited, modified, or withdrawn at our discretion.

### 7. Third-party services

The Service relies on third-party providers, including an AI model provider (model inference) and a database provider (authentication and data storage). Your use of the Service is also subject to those providers' applicable terms to the extent they govern the underlying infrastructure. We are not responsible for outages, changes, or errors originating from a third-party provider, though we will make reasonable efforts to maintain continuity of service.

### 8. Disclaimers

THE SERVICE, INCLUDING ALL OUTPUTS, IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT OUTPUTS WILL BE ACCURATE, COMPLETE, RELIABLE, OR SUITABLE FOR ANY PARTICULAR PURPOSE, OR THAT THE SERVICE WILL BE UNINTERRUPTED OR ERROR-FREE. NOTHING IN THE SERVICE CONSTITUTES LEGAL, FINANCIAL, TAX, MEDICAL, OR OTHER LICENSED PROFESSIONAL ADVICE. Some jurisdictions do not allow the exclusion of certain warranties, so some of the above exclusions may not apply to you.

### 9. Limitation of liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, BLAYNE'S CONSULTING AND ITS OFFICERS, EMPLOYEES, AND SUPPLIERS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUE, DATA, OR GOODWILL, ARISING FROM OR RELATED TO YOUR USE OF THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL AGGREGATE LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM AROSE, OR (B) ONE HUNDRED U.S. DOLLARS (US$100). Some jurisdictions do not allow certain limitations of liability, so some of the above limitations may not apply to you, in which case our liability is limited to the fullest extent such law permits.

### 10. Indemnification

You agree to indemnify, defend, and hold harmless Blayne's Consulting and its officers, employees, and agents from any claim, liability, damage, loss, or expense (including reasonable attorneys' fees) arising out of or related to: (a) your Inputs; (b) your use of Outputs in violation of Section 5; (c) your violation of these Terms or applicable law; or (d) your violation of any third party's rights.

### 11. Intellectual property

The Service, including its software, design, trademarks, and the B.L.A.Y.N.E name and mark, is owned by Blayne's Consulting or its licensors and is protected by intellectual-property laws. Except for the limited rights expressly granted in these Terms, no rights are transferred to you.

### 12. Termination

You may stop using the Service and request account deletion at any time by contacting **[team@blaynes.consulting](mailto:team@blaynes.consulting)**. We may suspend or terminate your access at any time for a violation of these Terms, a legal or safety reason, or if we discontinue the Service, with notice where practicable. Sections 5, 8, 9, 10, 13, and 14 survive termination.

### 13. Governing law and dispute resolution

These Terms are governed by the laws of the **Federal Republic of Nigeria**, without regard to conflict-of-laws principles. The parties will first attempt to resolve any dispute arising out of or relating to these Terms or the Service through good-faith negotiation. If a dispute is not resolved within 30 days, it will be referred to and finally resolved by arbitration in **Lagos, Nigeria**, conducted in English under the Arbitration and Mediation Act 2023 (or its successor legislation), before a single arbitrator. The award will be final and binding, and judgment on it may be entered in any court of competent jurisdiction. Nothing in this Section prevents either party from seeking urgent injunctive relief from a competent court, and nothing in this Section deprives a consumer resident outside Nigeria of any non-waivable right to bring a claim in their local courts or before a local regulator where their local mandatory consumer-protection law requires it.

### 14. General

- **Changes to these Terms.** We may update these Terms from time to time. We will post the updated Terms with a new "Last updated" date and, for material changes, provide notice (such as an in-app notice or email). Continued use after the effective date constitutes acceptance.
- **Entire agreement.** These Terms, together with the Safety Addendum and Privacy Policy, are the entire agreement between you and Blayne's Consulting regarding the Service and supersede prior agreements on the subject.
- **Severability.** If any provision is found unenforceable, the remaining provisions remain in full effect, and the unenforceable provision will be reformed to the minimum extent necessary to make it enforceable.
- **No waiver.** Our failure to enforce a provision is not a waiver of our right to do so later.
- **Assignment.** You may not assign these Terms without our consent; we may assign them in connection with a merger, acquisition, or sale of assets.

### 15. Contact

Questions about these Terms: **[team@blaynes.consulting](mailto:team@blaynes.consulting)**, or via **[www.blaynesconsulting.com](https://www.blaynesconsulting.com)**.
`.trim();

export const PRIVACY_POLICY_MD = `
_Last updated: ${LAST_UPDATED}_

Blayne's Consulting ("**Blayne's**," "**we**," "**us**") is incorporated and operates in the Federal Republic of Nigeria. This Privacy Policy explains how we collect, use, disclose, and protect information when you use B.L.A.Y.N.E (the "**Service**"). It is written primarily to meet our obligations under Nigeria's Data Protection Act 2023 ("**NDPA**") and the Nigeria Data Protection Commission's ("**NDPC**") General Application and Implementation Directive, and additionally to meet the disclosure expectations of other regimes our users may be resident in — including the EU/UK GDPR and the California Consumer Privacy Act as amended by the CPRA — while remaining a single policy for all users. Region-specific rights are called out in Section 8.

### 1. Information we collect

**a. Information you provide.** Account details (name, email, phone number), onboarding details (company name and size, intended use case), any brand materials or documents you upload, and the content of your conversations with B.L.A.Y.N.E ("**Chat Content**").

**b. Information collected automatically.** Usage data (features used, daily message counts against your quota, timestamps), device and log data (IP address, browser type, approximate location derived from IP), and cookies or similar technologies used to keep you signed in and to understand product usage (see Section 6).

**c. Information from third parties.** If you sign in with Google, we receive your name, email address, and profile image from Google as part of the OAuth flow.

We do not knowingly collect special-category data (health, biometric, genetic, or similar sensitive data) about you, and ask that you not submit such data as Chat Content or an uploaded document unless it is strictly necessary for the service you're asking B.L.A.Y.N.E to help with and you have a lawful basis to share it with us.

### 2. How we use information

We use the information above to: provide and operate the Service, including generating Outputs from your Chat Content; authenticate you and secure your account; enforce daily usage quotas; personalize B.L.A.Y.N.E's responses using brand materials you've shared; monitor for and investigate abuse or safety issues under the Advanced AI Model Safety Addendum; communicate with you about your account, beta updates, or changes to our terms; and comply with legal obligations.

We do not sell your personal information, and we do not use your Chat Content to train AI models that we operate. Where your Chat Content is processed by our AI model provider to generate a response, that provider's own data-handling terms for API customers apply to that processing, and — consistent with those terms — API inputs and outputs are not used to train the provider's models by default.

### 3. Legal bases for processing

Under the NDPA, and equivalently under the GDPR or UK GDPR where they apply to you, we process your information under the following lawful bases: performance of a contract (providing the Service you signed up for), our legitimate interests (securing the Service, preventing abuse, improving the product) balanced against your rights, your consent (where we ask for it, such as certain cookies or marketing communications, which you may withdraw at any time), and compliance with a legal obligation.

### 4. Who we share information with

- **Service providers acting on our behalf**, under contract and only for the purposes described here: our AI model provider (to generate AI Outputs from your Chat Content and any brand materials you attach), our database provider (authentication, database, and file storage), and hosting/infrastructure providers.
- **Legal and safety disclosures**: where required by law, legal process, or a good-faith belief that disclosure is necessary to protect the rights, property, or safety of Blayne's Consulting, our users, or the public, or to investigate a suspected violation of the Advanced AI Model Safety Addendum.
- **Business transfers**: if Blayne's Consulting is involved in a merger, acquisition, financing, or sale of assets, information may be transferred as part of that transaction, subject to this Policy or a successor policy with materially equivalent protections.

We do not share your personal information with third parties for their own independent marketing purposes, and we do not sell or "share" personal information as those terms are defined under the CCPA/CPRA.

### 5. International data transfers

Blayne's Consulting is based in Nigeria, and our service providers (including our AI model and database providers) process information in the United States and other countries outside Nigeria. Where the NDPA requires it, we transfer personal information outside Nigeria only where the recipient country has an adequate level of data protection as recognized by the NDPC, or where we have put in place appropriate safeguards with our processors, such as standard contractual clauses. Where we transfer personal information out of the EEA, UK, or Switzerland, we similarly rely on appropriate safeguards, such as the European Commission's Standard Contractual Clauses or an equivalent recognized transfer mechanism.

### 6. Cookies and similar technologies

We use strictly necessary cookies/local storage to keep you signed in and remember basic preferences, and limited analytics to understand feature usage in aggregate. We do not use third-party advertising cookies. Where required by local law, we will present a cookie notice allowing you to accept or decline non-essential cookies before they are set.

### 7. Data retention

We retain account and profile information for as long as your account is active, and Chat Content and usage logs for as long as reasonably necessary to provide the Service, secure it, resolve disputes, and comply with legal obligations — typically no longer than 24 months after account deletion unless a longer period is required by law or an open safety investigation. You may request earlier deletion under Section 8.

### 8. Your rights

Depending on where you live, you may have some or all of the following rights over your personal information: to access a copy of it; to correct inaccurate information; to delete it; to restrict or object to certain processing; to receive it in a portable format; to withdraw consent where processing is based on consent; and, for California residents, to know the categories of information collected and disclosed, and to non-discrimination for exercising these rights (noting again that we do not sell or share personal information for cross-context behavioral advertising). Because access to the Service requires an account, most of these requests can be exercised directly from your account, and all can be requested at **[team@blaynes.consulting](mailto:team@blaynes.consulting)**. We will respond within the time required by applicable law (for example, within a reasonable period and no later than required under the NDPA, 30 days under the GDPR, or 45 days under the CCPA/CPRA), and may need to verify your identity before acting on a request.

You also have the right to lodge a complaint with the Nigeria Data Protection Commission (NDPC), or, if you are in the EEA or UK, with your local data protection authority.

### 9. Security

We use technical and organizational measures appropriate to the sensitivity of the information involved, including encryption in transit, row-level access controls on our database (Row Level Security policies restricting each account to its own data), and restricted internal access to production systems. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.

### 10. Children's privacy

The Service is not directed to, and we do not knowingly collect personal information from, anyone under 18. If we learn we have collected personal information from a child under 18, we will delete it.

### 11. Automated processing

B.L.A.Y.N.E generates Outputs using AI models based on your Chat Content. This is not automated decision-making that produces legal or similarly significant effects about you personally under Article 22 GDPR — B.L.A.Y.N.E produces draft business content for your own review and use, not a decision applied to you. See the [Advanced AI Model Safety Addendum](/safety-addendum) for the human-oversight expectations that apply when you use Outputs for high-stakes decisions.

### 12. Changes to this Policy

We may update this Privacy Policy from time to time. We will post the revised Policy with a new "Last updated" date and, for material changes, provide additional notice (such as an in-app notice or email) before the change takes effect.

### 13. Contact us

For any question about this Policy or to exercise a privacy right: **[team@blaynes.consulting](mailto:team@blaynes.consulting)**, or via **[www.blaynesconsulting.com](https://www.blaynesconsulting.com)**.
`.trim();
