"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { CustomerProfile } from "@/lib/types";

interface CustomerSelectorProps {
  selectedCustomerId: string | null;
  onSelect: (customerId: string | null) => void;
  className?: string;
}

export function CustomerSelector({
  selectedCustomerId,
  onSelect,
  className = "",
}: CustomerSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [recentCustomerIds, setRecentCustomerIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load customers on mount
  useEffect(() => {
    async function fetchCustomers() {
      setLoading(true);
      try {
        const res = await fetch("/api/customers");
        if (res.ok) {
          const data = await res.json();
          setCustomers(data.customers || []);
        }
      } catch (err) {
        console.error("Failed to load customers:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchCustomers();

    // Load recent customers from localStorage
    const stored = localStorage.getItem("recentCustomers");
    if (stored) {
      try {
        setRecentCustomerIds(JSON.parse(stored));
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Save to recent customers
  const saveToRecent = useCallback((customerId: string) => {
    const updated = [customerId, ...recentCustomerIds.filter((id) => id !== customerId)].slice(0, 5);
    setRecentCustomerIds(updated);
    localStorage.setItem("recentCustomers", JSON.stringify(updated));
  }, [recentCustomerIds]);

  const handleSelect = (customer: CustomerProfile | null) => {
    if (customer) {
      saveToRecent(customer.id);
      onSelect(customer.id);
    } else {
      onSelect(null);
    }
    setIsOpen(false);
    setSearchQuery("");
  };

  // Filter customers based on search
  const filteredCustomers = searchQuery.trim()
    ? customers.filter(
        (c) =>
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (c.code && c.code.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : [];

  // Get recent customers (only when no search query)
  const recentCustomers = !searchQuery.trim()
    ? recentCustomerIds
        .map((id) => customers.find((c) => c.id === id))
        .filter((c): c is CustomerProfile => c !== undefined)
    : [];

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Search Input - Glassmorphic */}
      <div
        className={`
          flex items-center gap-3 px-4 py-3 rounded-xl glass-card
          cursor-text transition-all duration-300
          ${isOpen ? "!border-cyan-400/30 shadow-[0_0_20px_rgba(0,240,255,0.1)]" : "hover:!border-white/15"}
        `}
        onClick={() => {
          setIsOpen(true);
          inputRef.current?.focus();
        }}
      >
        <svg
          className={`w-5 h-5 shrink-0 transition-all duration-300 ${isOpen ? "text-cyan-400 drop-shadow-[0_0_8px_rgba(0,240,255,0.5)]" : "text-gray-500"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={isOpen ? searchQuery : (selectedCustomer?.name || "")}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder="Search customer..."
          className="flex-1 bg-transparent text-base text-white placeholder:text-gray-500 focus:outline-none min-w-0"
        />
        {selectedCustomer && !isOpen && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleSelect(null);
            }}
            className="p-1 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown - Glassmorphic */}
      {isOpen && (
        <div className="absolute z-50 top-full left-0 right-0 mt-2 glass-card rounded-xl shadow-2xl max-h-80 overflow-auto">
          {loading ? (
            <div className="px-4 py-4 text-sm text-gray-400">Loading customers...</div>
          ) : (
            <>
              {/* Recent customers (when no search) */}
              {recentCustomers.length > 0 && !searchQuery.trim() && (
                <div>
                  <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Recently Selected
                  </div>
                  {recentCustomers.map((customer) => (
                    <CustomerOption
                      key={customer.id}
                      customer={customer}
                      isSelected={customer.id === selectedCustomerId}
                      onClick={() => handleSelect(customer)}
                    />
                  ))}
                  <div className="border-t border-white/5 my-1" />
                </div>
              )}

              {/* Search results */}
              {searchQuery.trim() && (
                filteredCustomers.length > 0 ? (
                  <div>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Results
                    </div>
                    {filteredCustomers.map((customer) => (
                      <CustomerOption
                        key={customer.id}
                        customer={customer}
                        isSelected={customer.id === selectedCustomerId}
                        onClick={() => handleSelect(customer)}
                        searchQuery={searchQuery}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-4 text-sm text-gray-400">
                    No customers found for "{searchQuery}"
                  </div>
                )
              )}

              {/* All customers (when no search and no recents) */}
              {!searchQuery.trim() && recentCustomers.length === 0 && customers.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    All Customers
                  </div>
                  {customers.slice(0, 10).map((customer) => (
                    <CustomerOption
                      key={customer.id}
                      customer={customer}
                      isSelected={customer.id === selectedCustomerId}
                      onClick={() => handleSelect(customer)}
                    />
                  ))}
                </div>
              )}

              {/* No customer option */}
              <div className="border-t border-white/5 mt-1 pt-1">
                <button
                  onClick={() => handleSelect(null)}
                  className="w-full px-4 py-3 text-left text-sm text-gray-400 hover:bg-white/5 hover:text-gray-300 transition-colors"
                >
                  No customer (parse without rules)
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CustomerOption({
  customer,
  isSelected,
  onClick,
  searchQuery,
}: {
  customer: CustomerProfile;
  isSelected: boolean;
  onClick: () => void;
  searchQuery?: string;
}) {
  // Highlight matching text
  const highlightMatch = (text: string) => {
    if (!searchQuery) return text;
    const idx = text.toLowerCase().indexOf(searchQuery.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="font-semibold text-cyan-400">{text.slice(idx, idx + searchQuery.length)}</span>
        {text.slice(idx + searchQuery.length)}
      </>
    );
  };

  return (
    <button
      onClick={onClick}
      className={`
        w-full px-4 py-3 text-left flex items-center gap-3 transition-all duration-200
        ${isSelected ? "bg-cyan-500/10" : "hover:bg-white/5"}
      `}
    >
      {/* Avatar placeholder */}
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-500/30 to-cyan-500/10 flex items-center justify-center text-cyan-400 text-xs font-bold shrink-0 border border-cyan-500/20">
        {customer.name.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-white truncate">
          {highlightMatch(customer.name)}
        </div>
        {customer.code && (
          <div className="text-xs text-gray-500">
            {highlightMatch(customer.code)}
          </div>
        )}
      </div>
      {isSelected && (
        <svg className="w-5 h-5 text-cyan-400 icon-glow shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}
