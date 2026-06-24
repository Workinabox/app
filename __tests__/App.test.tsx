import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('renders without crashing', async () => {
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<App />);
  });
});
