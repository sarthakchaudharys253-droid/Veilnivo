import type {Metadata} from 'next';
import LegalPage from '@/components/legal/LegalPage';
import {acceptableUseSections} from '@/components/legal/policy-content';
export const metadata:Metadata={title:'Acceptable use — Veilnivo',description:'Rules for lawful messaging, contact consent, safety concerns, prohibited conduct and legal requests on Veilnivo.'};
export default function AcceptableUsePage(){return <LegalPage document="acceptable-use" title="Private conversations. Responsible use." description="A username and encryption reduce unnecessary exposure. They do not give anyone permission to harm others or break the law." summary={['Criminal activity, exploitation, threats, scams and harassment are prohibited.','Respect requests, blocks, group members and other people’s privacy.','No secret AI surveillance or automatic government reporting is enabled.']} sections={acceptableUseSections}/>}
