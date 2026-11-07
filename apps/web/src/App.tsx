import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CategoryPage } from './features/category/CategoryPage';
import { HomePage } from './features/home/HomePage';
import { NotFound } from './features/NotFound';
import { ProductPage } from './features/product/ProductPage';
import { SearchPage } from './features/search/SearchPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="categories/:slug" element={<CategoryPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="products/:id" element={<ProductPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
