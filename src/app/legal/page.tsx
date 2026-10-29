import type {Metadata} from 'next';
import LegalPage,{LegalCards} from '@/components/legal/LegalPage';
import {overviewSections} from '@/components/legal/policy-content';
export const metadata:Metadata={title:'Privacy, terms and safety — Veilnivo',description:'Read Veilnivo’s privacy policy, terms of use, acceptable use rules, current beta limits and operator details.'};
export default function LegalOverviewPage(){return <LegalPage document="overview" title="Trust starts with clarity." description="Read how Veilnivo works, what we ask of our community, and what the current beta can and cannot promise." summary={['Start with a username and password. No phone number or email.','Encryption protects content; it does not erase every privacy risk.','Rules and valid legal requests still apply to a private messenger.']} sections={overviewSections}><LegalCards/></LegalPage>}
