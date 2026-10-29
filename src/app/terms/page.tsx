import type {Metadata} from 'next';
import LegalPage from '@/components/legal/LegalPage';
import {termsSections} from '@/components/legal/policy-content';
export const metadata:Metadata={title:'Terms of use — Veilnivo',description:'The terms for using Veilnivo’s public beta, accounts, messaging, inactive plans and availability.'};
export default function TermsPage(){return <LegalPage document="terms" title="Clear terms for a shared space." description="The responsibilities, features and practical limits that come with using the Veilnivo public beta." summary={['For adults aged 18 or over and lawful communication.','Protect your password. There is no phone or email recovery.','The beta is free; Plus payments and cloud AI remain inactive.']} sections={termsSections}/>}
