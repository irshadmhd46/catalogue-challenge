import { useQuery } from '@tanstack/react-query';
import { getCategories, getCategoryPage, getFeatured, getProduct, searchProducts } from './client';

export const useFeatured = () => useQuery({ queryKey: ['featured'], queryFn: getFeatured });

export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: getCategories });

export const useCategoryPage = (slug: string) =>
  useQuery({ queryKey: ['category', slug], queryFn: () => getCategoryPage(slug) });

export const useSearch = (query: string) =>
  useQuery({
    queryKey: ['search', query],
    queryFn: () => searchProducts(query),
    enabled: query !== '',
  });

export const useProduct = (id: string) =>
  useQuery({ queryKey: ['product', id], queryFn: () => getProduct(id) });
