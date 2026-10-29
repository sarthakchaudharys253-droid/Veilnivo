import type {Metadata} from 'next';
import LegalPage,{LegalContact,PolicyList,PolicyNote,type LegalSection} from '@/components/legal/LegalPage';

export const metadata:Metadata={title:'Contact & safety | Veilnivo',description:'Privacy requests, safer use, reporting guidance and legal requests for the Veilnivo public beta.'};

const sections:LegalSection[]=[
 {id:'contact',title:'Contact and privacy requests',content:<>
  <p>You do not need a phone number, Gmail account or another email address to create a Veilnivo account. Contacting the operator is a separate, voluntary action. Your chosen contact method may reveal details that your Veilnivo account does not contain.</p>
  <LegalContact/>
  <p>For a privacy request, explain what you need and provide only the account identifier and information necessary to locate the relevant records. Do not send a password or encryption key as proof of ownership. Applicable rights and identity checks depend on the request and the law that applies.</p>
 </>},
 {id:'protect-yourself',title:'Protect yourself in a conversation',content:<>
  <PolicyList><li>Review message requests before accepting someone. Use Block contact in a direct conversation’s menu to stop that contact from messaging you directly.</li><li>Check a contact’s identity fingerprint through another trusted channel. A familiar username alone does not verify a real-world identity.</li><li>Group members can read and copy messages shared with the group. Blocking someone in a direct chat does not hide their messages in a shared group.</li><li>Use chat lock and session lock on shared devices. Chat lock hides conversations in the interface on this device; it is not an additional identity or a separate encryption boundary.</li><li>Do not open files or links you do not trust. Encryption does not make the sender or their files safe.</li></PolicyList>
 </>},
 {id:'reporting',title:'Report abuse with chosen information',content:<>
  <p>Fraud, threats, exploitation, harassment, malware and other unlawful activity are prohibited by the <a href="/acceptable-use/">Acceptable use rules</a>. Signing up without a phone number or email does not exempt anyone from the law.</p>
  <p>You may choose to email a report to the operator using the address above. Include the relevant username, approximate time and time zone, a short description, and only the evidence you choose to share. A report is a claim to assess, not proof that someone committed an offence. There is currently no automatic in-app report submission or guaranteed response time.</p>
  <PolicyNote><strong>You control what you disclose.</strong><p>Veilnivo does not automatically forward a conversation when you view this page. Information you voluntarily send outside the encrypted conversation can be readable by its recipient and their contact provider. Never share unrelated chats, passwords, chat-lock codes, private keys or illegal imagery.</p></PolicyNote>
  <p>This service is not an emergency channel and does not provide continuous safety monitoring. For immediate danger, contact the emergency services responsible for your location.</p>
 </>},
 {id:'ai-and-privacy',title:'No automatic AI scanning',content:<>
  <p>Ollama Cloud is inactive. Veil AI does not monitor private conversations, identify criminals, score users for government access or notify authorities. The server stores encrypted chat content and does not receive the ordinary plaintext of peer messages.</p>
  <p>If the optional assistant is activated in a future release, the AI provider would receive explicit questions sent to Veil AI after the assistant privacy notice is accepted. Peer conversations are not attached automatically. An exact configured chat-lock code is checked on the device and opens the local locked-chat section without sending that code to the assistant.</p>
  <p>Privacy is not conditional on an automated suspicion score. Read the <a href="/privacy/">Privacy policy</a> for the account, connection and messaging metadata that the service and its hosting providers can process.</p>
 </>},
 {id:'legal-requests',title:'Requests from public authorities',content:<>
  <p>Public authorities should use the operator’s published legal email and identify the requesting authority, jurisdiction, applicable legal basis, specific records sought, relevant account identifiers and time period, and a verifiable case or request reference.</p>
  <p>The operator may verify a request and seek clarification. Information actually held may be disclosed where required by valid legal process or applicable law. A request, allegation or general suspicion does not give the service technical access to plaintext that it does not possess. This website does not offer an automatic government-access or decryption channel.</p>
  <p>There is no dedicated law-enforcement portal. Legal requests need to reach the operator through a published contact and be handled under the law that applies.</p>
 </>},
 {id:'account-controls',title:'Account and data controls',content:<>
  <PolicyList><li>Use Settings to change preferences and manage aliases. Keep your password safe: Veilnivo has no phone- or email-based password recovery.</li><li>Clear chat and Delete for me remove local copies on this device. They do not erase the other person’s copy or the server’s encrypted records.</li><li>Delete for everyone applies to eligible own direct messages while unread and for 30 minutes after the recipient first reads them. It cannot recall screenshots, downloads or exported copies.</li><li>Erase everything separately displays local and server erasure results. A failed or offline server request is not a confirmed server deletion.</li></PolicyList>
  <p>See the <a href="/privacy/#retention">retention section</a> for timers, browser storage and the limits of deletion.</p>
 </>},
 {id:'security-issues',title:'Security issues and non-confidential bugs',content:<>
  <p>Use the operator’s published privacy email for a private security report. Do not post credentials, private conversations or exploit details affecting other people in a public issue tracker. The <a href="https://github.com/sarthakchaudharys253-droid/Veilnivo" target="_blank" rel="noopener noreferrer">public source project (opens in a new tab)</a> can provide technical context; it is not a confidential privacy or abuse inbox.</p>
 </>},
];

export default function Support(){return <LegalPage document="support" title="Contact & safety" description="Know your controls, choose what to report, and understand what the service can actually access." summary={['No phone number or email is needed to register.','Private chats are not scanned by AI.','A report shares only the information you choose to send.']} sections={sections}/>;}
