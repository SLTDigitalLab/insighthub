import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ProposalAgent from '../components/ProposalAgent';
import ProposalHubHeader from '../components/ProposalHubHeader';
import SolutionProposal from './SolutionProposal';
import {
  getProductSolutionTemplate, uploadProductSolutionExcel, extractProductSolution, getProductSolutionProposal,
  saveProductSolutionFields, exportProductSolutionProposal, downloadProductSolutionSource, regenerateProductSolutionProposal
} from '../api';
import { productSolutionFileRef } from '../utils/fileNames';

// Product + Solution proposal (the third proposal type): ONE proposal from the active Product + Solution template.
//   1. tick the products (no business step; the customer comes from the Excel) -> the Product page's product picker (ProposalAgent, mode 'productSolution')
//   2. "Upload the Excel sheet"                       -> the Solution page's own upload / sheet / edit / preview screens (SolutionProposal, this flow)
// The edit screen is built from the active template's tags, so a new template needs no change here. Same as the Solution page there is no
// "please check before sending" box.

const ADMIN_EMAILS = ['dineshpi@slt.com.lk', '020601@intranet.slt.com.lk', 'lahirus@slt.com.lk']; // same list as ProposalHub

// What the shared Solution screen needs to run as the Product + Solution page. Open to every approved user (the server checks the sign-in),
// like the Product page; only the template upload stays with admins.
const FLOW = {
  api: {
    getTemplate: getProductSolutionTemplate, upload: uploadProductSolutionExcel, extract: extractProductSolution,
    get: getProductSolutionProposal, save: saveProductSolutionFields, exportFile: exportProductSolutionProposal, source: downloadProductSolutionSource, regenerate: regenerateProductSolutionProposal,
  },
  adminOnly: false,
  subtitle: 'Product + Solution Proposal',
  templateWords: 'Product + Solution template',
  templateType: 'productSolution', generatePath: '/proposals/product-solution',
  noTemplate: { title: 'No Product + Solution template yet', text: 'Product + Solution', type: 'Product + Solution template', href: '/proposals/product?tab=template&type=productSolution' },
  fileSuffix: 'Product_Solution',
  fileRef: productSolutionFileRef,
  startAnother: 'Start another Product + Solution proposal',
};

export default function ProductSolutionProposal() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawRef = (searchParams.get('ref') || '').trim();
  const hasRef = /^[A-Za-z0-9._-]{1,100}$/.test(rawRef) && !rawRef.includes('..'); // an opened proposal: straight to the edit screen
  const [selection, setSelection] = useState(null); // { productIds } once the products are chosen (a refresh starts again at the product picker)
  const [isAdmin, setIsAdmin] = useState(false); // same rule as the Product page: only the template tab is for admins
  const [proposalUser, setProposalUser] = useState({ name: '', email: '', designation: '', phone: '', division: '' });

  useEffect(() => {
    const email = (localStorage.getItem('userEmail') || '').toLowerCase().trim();
    const name = localStorage.getItem('userName') || 'Account Manager';
    setProposalUser({ name, email, designation: '', phone: '', division: '' });
    setIsAdmin(localStorage.getItem('userRole') === 'admin' || ADMIN_EMAILS.includes(email));
    if (!email) return;
    axios.post('/api/auth/verify-access', { email }).then(res => {
      const u = (res.data && res.data.approved && res.data.user) || {};
      const clean = v => String(v || '').trim();
      setProposalUser({ name: clean(u.name) || name, email: clean(u.email) || email, designation: clean(u.designation), phone: clean(u.mobileNumber), division: clean(u.department) || clean(u.rebmArea) });
    }).catch(() => { /* the details typed at sign-in stay */ });
  }, []);

  const startOver = () => { setSelection(null); setSearchParams({}, { replace: true }); };

  const header = <ProposalHubHeader activeTab="generator" type="productSolution" typeLabel="Product + Solution Proposal" onGenerate={startOver} showGenerate showTemplate={isAdmin} />;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column', color: '#0f172a', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {header}
      <main style={{ flex: 1, padding: '28px 24px', width: '100%', boxSizing: 'border-box' }}>
        {hasRef || selection ? (
          <SolutionProposal flow={FLOW} selection={selection} onStartOver={startOver} embedded />
        ) : (
          <ProposalAgent user={proposalUser} mode="productSolution" onProductsChosen={setSelection} onBack={() => navigate('/proposals')} />
        )}
      </main>
    </div>
  );
}
